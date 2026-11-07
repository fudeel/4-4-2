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
/** Metres per unit of team space, across and along the pitch. */
const METRES_X = PITCH.width / 2 - 1;
const METRES_Y = PITCH.length;

/**
 * Where every player wants to be, given the ball and who has it. No randomness: the shape
 * moves only when the ball moves, the way a coached team does.
 *
 * In possession the team stretches the pitch: full width, forwards on the shoulder of the last
 * defender, the two nearest teammates offering a forward angle and a safe recycle option.
 * Out of possession it shrinks: narrow, shifted to the ball side, goal-side of the ball,
 * with the nearest player closing the carrier down.
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
      } else if (ctx.possession === side) {
        const lastLine = this.offsideLine(ctx, side);
        for (const p of team) spots.set(p, p.slot.role === 'GK' ? this.keeperSpot(ball, true) : this.attackingSpot(p.slot, ball, mentality, lastLine));
        this.offerSupport(ctx, side, team, spots);
      } else {
        for (const p of team) spots.set(p, p.slot.role === 'GK' ? this.keeperSpot(ball, false) : this.defendingSpot(p.slot, ball, mentality));
      }

      this.separate(ctx, spots);
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

  private defendingSpot(slot: FormationSlot, ball: Spot, mentality: number): Spot {
    const push = -0.04 + mentality * MENTALITY_LINE_SHIFT;
    let ny = slot.y + push + (ball.ny - 0.5) * 0.42;
    // Narrow and shifted to the ball side.
    const nx = slot.x * 0.72 + ball.nx * 0.32;
    switch (slot.role) {
      case 'DEF':
        ny = MathUtils.clamp(Math.min(ny, ball.ny - 0.04), 0.06, 0.45);
        break;
      case 'MID':
        ny = MathUtils.clamp(Math.min(ny, ball.ny - 0.02), 0.12, 0.62);
        break;
      default:
        ny = MathUtils.clamp(ny, 0.3, 0.68);
    }
    return { nx: MathUtils.clamp(nx, -0.85, 0.85), ny };
  }

  private keeperSpot(ball: Spot, inPossession: boolean): Spot {
    const ny = 0.025 + MathUtils.clamp(ball.ny, 0, 0.7) * (inPossession ? 0.1 : 0.06);
    return { nx: MathUtils.clamp(ball.nx * 0.15, -0.12, 0.12), ny };
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

  /** The nearest outfield player closes down the ball, staying goal-side of it. */
  private press(ctx: ShapeContext, side: Side, team: ShapePlayer[]): void {
    let presser: ShapePlayer | null = null;
    let best = Infinity;
    for (const p of team) {
      if (p.slot.role === 'GK') continue;
      const d = p.actor.position.distanceToSquared(ctx.ball);
      if (d < best) {
        best = d;
        presser = p;
      }
    }
    if (!presser) return;
    const ownGoal = ctx.space.toWorld(side, 0, 0, 0, this.tmp);
    const toGoal = ownGoal.sub(ctx.ball).setY(0);
    const target = this.targets.get(presser.actor.id)!;
    target.copy(ctx.ball).setY(0).addScaledVector(toGoal.normalize(), PRESS_DISTANCE);
  }

  /**
   * The offside line for `side`'s attackers: the second-last opponent (the keeper is usually
   * the last), never inside the attackers' own half. In the attackers' team space.
   */
  private offsideLine(ctx: ShapeContext, side: Side): number {
    const depths = ctx.players
      .filter(p => p.actor.side === otherSide(side))
      .map(p => ctx.space.toTeam(side, p.actor.position).ny)
      .sort((a, b) => b - a);
    return Math.max(0.5, depths[1] ?? depths[0] ?? 0.5);
  }

  /** Pushes teammates apart when they crowd the same patch of grass. */
  private separate(ctx: ShapeContext, spots: Map<ShapePlayer, Spot>): void {
    const entries = [...spots.entries()].filter(([p]) => p.slot.role !== 'GK' && p.actor !== ctx.holder);
    const minX = PERSONAL_SPACE / METRES_X;
    const minY = PERSONAL_SPACE / METRES_Y;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i]![1];
          const b = entries[j]![1];
          // In units of personal space, so the test is a circle on the grass.
          const dx = (b.nx - a.nx) / minX;
          const dy = (b.ny - a.ny) / minY;
          const d = Math.hypot(dx, dy);
          if (d >= 1) continue;
          const push = (1 - d) / 2;
          const ux = d > 1e-4 ? dx / d : 1;
          const uy = d > 1e-4 ? dy / d : 0;
          a.nx -= ux * push * minX;
          a.ny -= uy * push * minY;
          b.nx += ux * push * minX;
          b.ny += uy * push * minY;
        }
      }
    }
  }
}
