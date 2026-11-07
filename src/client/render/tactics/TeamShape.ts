import { MathUtils, Vector3 } from 'three';
import type { FormationSlot } from '../../../shared/model/formation';
import { SIDES, otherSide, type Side } from '../../../shared/model/match';
import { PITCH, type PitchSpace } from '../PitchSpace';

/** What the tactics code needs to know about a player on the pitch. */
export interface Mover {
  readonly id: string;
  readonly side: Side;
  readonly position: Vector3;
}

export interface ShapePlayer<A extends Mover = Mover> {
  actor: A;
  slot: FormationSlot;
}

export interface ShapeContext {
  space: PitchSpace;
  players: readonly ShapePlayer[];
  /** Where the ball is — or where it will land, when it is in the air. */
  ball: Vector3;
  holder: Mover | null;
  /** The side on the ball (null before kick-off and during breaks). */
  possession: Side | null;
  /** Mentality slider per side, −100 … 100. */
  mentality: Record<Side, number>;
}

/** A point in team space: nx −1 (left) … 1 (right), ny 0 (own goal) … 1 (opponent goal). */
interface Spot {
  nx: number;
  ny: number;
}

/** How far (in team space) the whole block moves at full attacking or defensive mentality. */
export const MENTALITY_LINE_SHIFT = 0.09;
/** Teammates closer than this (metres) push each other apart, so nobody stands in a teammate's space. */
const PERSONAL_SPACE = 6.5;
/** How far a supporting player stands from the ball carrier (metres). */
const SUPPORT_DISTANCE = 10;
/** The presser stops this far from the carrier, goal-side (metres). */
const PRESS_DISTANCE = 2.2;
/** The covering player sits this far behind the presser, on the way to goal (metres). */
const COVER_DISTANCE = 6;
/** The back line holds this far behind the ball (team space ≈ 9.6 m)… */
const BALL_TO_LINE = 0.2;
/** …and each line of the block sits this far in front of the one behind it (≈ 7 m). */
const LINE_GAP = 0.15;
/** How far a defender looks for an attacker to pick up, and a midfielder (metres). */
const DEFENDER_REACH = 10;
const MIDFIELDER_REACH = 8;
/** An attacker this far beyond the back line (team space ≈ 1.5 m) has made a run that must be tracked. */
const LINE_BREAK = 0.03;
const ROLE_ORDER: Record<FormationSlot['role'], number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
/** Metres per unit of team space, across and along the pitch. */
const METRES_X = PITCH.width / 2 - 1;
const METRES_Y = PITCH.length;

/**
 * Where every player wants to be, given the ball and who has it. No randomness: the shape
 * moves only when the ball moves, the way a coached team does.
 *
 * In possession the team stretches the pitch: full width, forwards on the shoulder of the last
 * defender, the two nearest teammates offering a forward angle and a safe recycle option.
 * Out of possession it becomes a compact block: a flat back line whose height is set by the
 * ball, defenders picking up the attackers in their zone goal-side, midfielders screening in
 * front of them, forwards cutting the pass back, the nearest player pressing, the next one
 * covering behind him, and the keeper on the line between ball and goal.
 */
export class TeamShape {
  private readonly targets = new Map<string, Vector3>();
  private readonly tmp = new Vector3();

  /** Targets in world space, keyed by player id. Valid until the next call. */
  compute(ctx: ShapeContext): ReadonlyMap<string, Vector3> {
    for (const side of SIDES) {
      const team = ctx.players.filter(p => p.actor.side === side);
      if (team.length === 0) continue;
      const ball = ctx.space.toTeam(side, ctx.ball);
      const spots = new Map<ShapePlayer, Spot>();
      const mentality = ctx.mentality[side] / 100;

      if (ctx.possession === null) {
        for (const p of team) spots.set(p, this.restingSpot(p.slot));
        this.separate(ctx, spots, new Set());
      } else if (ctx.possession === side) {
        const lastLine = this.offsideLine(ctx, side);
        for (const p of team) spots.set(p, p.slot.role === 'GK' ? this.keeperInPossession(ball) : this.attackingSpot(p.slot, ball, mentality, lastLine));
        this.offerSupport(ctx, side, team, spots);
        this.separate(ctx, spots, new Set());
        // Nobody drifts offside while the team keeps the ball (runs in behind are choreographed).
        const onside = Math.max(lastLine - 0.012, ball.ny);
        for (const [p, spot] of spots) if (p.slot.role !== 'GK') spot.ny = Math.min(spot.ny, onside);
      } else {
        this.defend(ctx, side, team, ball, mentality, spots);
        // The back line stays flat: defenders only space out sideways.
        this.separate(ctx, spots, new Set(team.filter(p => p.slot.role === 'DEF')));
      }
      for (const [p, spot] of spots) {
        const target = this.targets.get(p.actor.id) ?? new Vector3();
        ctx.space.toWorld(side, spot.nx, spot.ny, 0, target);
        this.targets.set(p.actor.id, target);
      }
      if (ctx.possession !== null && ctx.possession !== side) this.press(ctx, side, team);
      if (ctx.holder?.side === side) this.targets.get(ctx.holder.id)?.copy(ctx.holder.position).setY(0);
    }
    return this.targets;
  }

  /** The formation spot in the team's own half, used at kick-off and during breaks. */
  restingSpot(slot: FormationSlot): Spot {
    return { nx: slot.x, ny: slot.role === 'GK' ? 0.03 : Math.min(slot.y, 0.46) };
  }

  private attackingSpot(slot: FormationSlot, ball: Spot, mentality: number, lastLine: number): Spot {
    const push = 0.12 + mentality * MENTALITY_LINE_SHIFT;
    let ny = slot.y + push + (ball.ny - 0.45) * 0.45;
    // Hold the width; drift only slightly towards the ball.
    const nx = slot.x * 1.25 + (ball.nx - slot.x) * 0.12;
    switch (slot.role) {
      case 'DEF':
        ny = MathUtils.clamp(ny, 0.12, 0.6);
        break;
      case 'MID':
        ny = MathUtils.clamp(ny, 0.2, 0.8);
        break;
      default:
        // Forwards play on the shoulder of the last defender, stretching the defence — never offside.
        ny = Math.max(ny, lastLine - 0.03);
        ny = Math.min(ny, Math.max(lastLine - 0.012, ball.ny), 0.92);
    }
    return { nx: MathUtils.clamp(nx, -0.92, 0.92), ny };
  }

  /** Out of possession: the block, line by line (see the class comment). */
  private defend(ctx: ShapeContext, side: Side, team: ShapePlayer[], ball: Spot, mentality: number, spots: Map<ShapePlayer, Spot>): void {
    const line = backLine(ball, mentality);
    const attackers = ctx.players
      .filter(p => p.actor.side !== side && p.slot.role !== 'GK')
      .map(p => ({ player: p, at: ctx.space.toTeam(side, p.actor.position) }));
    const marked = new Set<ShapePlayer>();
    const pickUp = (zone: Spot, reach: number): Spot | null => {
      let best: { player: ShapePlayer; at: Spot } | null = null;
      let bestDistance = reach;
      for (const attacker of attackers) {
        if (marked.has(attacker.player)) continue;
        const d = metres(zone, attacker.at);
        if (d < bestDistance) {
          bestDistance = d;
          best = attacker;
        }
      }
      if (!best) return null;
      marked.add(best.player);
      return best.at;
    };
    // Their deepest player (nearest their own goal): forwards stand in the way of the pass back to him.
    const deepest = attackers.reduce<Spot | null>((acc, a) => (!acc || a.at.ny > acc.ny ? a.at : acc), null);

    // Defenders choose their man first, then midfielders.
    for (const p of [...team].sort((a, b) => ROLE_ORDER[a.slot.role] - ROLE_ORDER[b.slot.role])) {
      const { slot } = p;
      switch (slot.role) {
        case 'GK':
          spots.set(p, this.keeperGuard(ball));
          break;
        case 'DEF': {
          const zone = { nx: slot.x * 0.62 + ball.nx * 0.3, ny: line };
          const man = pickUp(zone, DEFENDER_REACH);
          // Pick up the attacker in his zone from the line; only an attacker already beyond the
          // line (a run in behind) drags the defender back goal-side of him. Holding the line
          // otherwise matters: dropping for an onside striker would walk the whole line back.
          const beyond = man !== null && man.ny < line - LINE_BREAK;
          spots.set(p, man ? { nx: MathUtils.lerp(zone.nx, man.nx, 0.55), ny: beyond ? man.ny - 0.03 : line } : zone);
          break;
        }
        case 'MID': {
          const ny = MathUtils.clamp(Math.min(line + LINE_GAP, ball.ny - 0.03), line + 0.05, 0.65);
          const zone = { nx: slot.x * 0.6 + ball.nx * 0.38, ny };
          const man = pickUp(zone, MIDFIELDER_REACH);
          spots.set(p, man ? { nx: MathUtils.lerp(zone.nx, man.nx, 0.35), ny: MathUtils.lerp(ny, Math.min(ny, man.ny - 0.03), 0.35) } : zone);
          break;
        }
        default: {
          const ny = MathUtils.clamp(line + LINE_GAP * 2 + mentality * 0.08, 0.3, 0.7);
          const screen = deepest
            ? { nx: MathUtils.lerp(ball.nx, deepest.nx, 0.4), ny: Math.max(ny, MathUtils.lerp(ball.ny, deepest.ny, 0.4)) }
            : { nx: slot.x * 0.5 + ball.nx * 0.3, ny };
          spots.set(p, { nx: MathUtils.clamp(screen.nx, -0.85, 0.85), ny: MathUtils.clamp(screen.ny, 0.3, 0.92) });
        }
      }
    }
  }

  /** On the line from the centre of the goal to the ball: further off the line the further away it is. */
  private keeperGuard(ball: Spot): Spot {
    const dx = ball.nx * METRES_X;
    const dy = Math.max(0.5, ball.ny * METRES_Y);
    const distance = Math.hypot(dx, dy);
    const out = MathUtils.clamp(1 + distance * 0.07, 1, 4.5);
    return { nx: MathUtils.clamp(((dx / distance) * out) / METRES_X, -0.2, 0.2), ny: ((dy / distance) * out) / METRES_Y + 0.004 };
  }

  /** In possession the keeper steps off his line to offer a safe pass back. */
  private keeperInPossession(ball: Spot): Spot {
    return { nx: MathUtils.clamp(ball.nx * 0.15, -0.12, 0.12), ny: 0.025 + MathUtils.clamp(ball.ny, 0, 0.7) * 0.1 };
  }

  /**
   * The two teammates nearest the carrier move into passing angles: one ahead at an angle
   * (towards the side with more room), one behind on the other side to recycle possession.
   */
  private offerSupport(ctx: ShapeContext, side: Side, team: ShapePlayer[], spots: Map<ShapePlayer, Spot>): void {
    const holder = ctx.holder;
    if (!holder || holder.side !== side) return;
    const carrier = ctx.space.toTeam(side, holder.position);
    const helpers = team
      .filter(p => p.actor !== holder && p.slot.role !== 'GK')
      .sort((a, b) => a.actor.position.distanceToSquared(holder.position) - b.actor.position.distanceToSquared(holder.position))
      .slice(0, 2);
    if (helpers.length === 0) return;

    // Go towards the middle when wide; otherwise towards the emptier flank.
    let lean = Math.abs(carrier.nx) > 0.45 ? -Math.sign(carrier.nx) : this.emptierFlank(ctx, side, carrier);
    if (lean === 0) lean = 1;
    const metresX = SUPPORT_DISTANCE / METRES_X;
    const metresY = SUPPORT_DISTANCE / METRES_Y;
    const angles: [number, number][] = [
      [lean * Math.sin(0.7), Math.cos(0.7)],
      [-lean * Math.sin(2.4), Math.cos(2.4)],
    ];
    helpers.forEach((helper, i) => {
      const [ax, ay] = angles[i]!;
      const spot = spots.get(helper)!;
      const target = {
        nx: MathUtils.clamp(carrier.nx + ax * metresX, -0.92, 0.92),
        ny: MathUtils.clamp(carrier.ny + ay * metresY, 0.08, 0.9),
      };
      spots.set(helper, { nx: MathUtils.lerp(spot.nx, target.nx, 0.75), ny: MathUtils.lerp(spot.ny, target.ny, 0.75) });
    });
  }

  /** −1 when the left of the carrier is emptier of opponents, 1 for the right. */
  private emptierFlank(ctx: ShapeContext, side: Side, carrier: Spot): number {
    let left = 0;
    let right = 0;
    for (const p of ctx.players) {
      if (p.actor.side === side || p.slot.role === 'GK') continue;
      const at = ctx.space.toTeam(side, p.actor.position);
      if (Math.abs(at.ny - carrier.ny) > 0.3) continue;
      if (at.nx < carrier.nx) left += 1;
      else right += 1;
    }
    return left === right ? 0 : left < right ? -1 : 1;
  }

  /**
   * The nearest outfield player closes the ball down, goal-side of it; the next nearest
   * (not a forward) drops in behind him, so one dribble doesn't beat the whole team.
   */
  private press(ctx: ShapeContext, side: Side, team: ShapePlayer[]): void {
    const chasers = team
      .filter(p => p.slot.role !== 'GK')
      .sort((a, b) => a.actor.position.distanceToSquared(ctx.ball) - b.actor.position.distanceToSquared(ctx.ball));
    const presser = chasers[0];
    if (!presser) return;
    const toGoal = ctx.space.toWorld(side, 0, 0, 0, this.tmp).sub(ctx.ball).setY(0);
    const distanceToGoal = toGoal.length();
    toGoal.normalize();
    this.targets.get(presser.actor.id)!.copy(ctx.ball).setY(0).addScaledVector(toGoal, PRESS_DISTANCE);
    const cover = chasers.slice(1).find(p => p.slot.role !== 'FWD');
    if (cover && distanceToGoal > COVER_DISTANCE + 3) {
      this.targets.get(cover.actor.id)!.copy(ctx.ball).setY(0).addScaledVector(toGoal, COVER_DISTANCE);
    }
  }

  /**
   * The offside line for `side`'s attackers, in their team space: the line the defenders intend
   * to hold (set by the ball, see `backLine`), never inside the attackers' own half. Reading the
   * defenders' intent rather than their current positions keeps the two shapes from chasing
   * each other towards goal.
   */
  private offsideLine(ctx: ShapeContext, side: Side): number {
    const defenders = otherSide(side);
    const line = backLine(ctx.space.toTeam(defenders, ctx.ball), ctx.mentality[defenders] / 100);
    return Math.max(0.5, 1 - line);
  }

  /** Pushes teammates apart when they crowd the same patch of grass. Players in `holdDepth` only move sideways. */
  private separate(ctx: ShapeContext, spots: Map<ShapePlayer, Spot>, holdDepth: ReadonlySet<ShapePlayer>): void {
    const entries = [...spots.entries()].filter(([p]) => p.slot.role !== 'GK' && p.actor !== ctx.holder);
    const minX = PERSONAL_SPACE / METRES_X;
    const minY = PERSONAL_SPACE / METRES_Y;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const [pa, a] = entries[i]!;
          const [pb, b] = entries[j]!;
          // In units of personal space, so the test is a circle on the grass.
          const dx = (b.nx - a.nx) / minX;
          const dy = (b.ny - a.ny) / minY;
          const d = Math.hypot(dx, dy);
          if (d >= 1) continue;
          const push = (1 - d) / 2;
          const ux = d > 1e-4 ? dx / d : 1;
          const uy = d > 1e-4 ? dy / d : 0;
          a.nx -= ux * push * minX;
          b.nx += ux * push * minX;
          if (!holdDepth.has(pa)) a.ny -= uy * push * minY;
          if (!holdDepth.has(pb)) b.ny += uy * push * minY;
        }
      }
    }
  }
}

/** Distance between two team-space spots, in metres. */
function metres(a: Spot, b: Spot): number {
  return Math.hypot((a.nx - b.nx) * METRES_X, (a.ny - b.ny) * METRES_Y);
}

/** Where a defending team holds its back line: a set distance behind the ball, higher when attack-minded. */
function backLine(ball: Spot, mentality: number): number {
  return MathUtils.clamp(ball.ny - BALL_TO_LINE + mentality * MENTALITY_LINE_SHIFT * 0.7, 0.07, 0.42);
}
