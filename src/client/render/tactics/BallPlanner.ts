import { MathUtils, Vector3 } from 'three';
import type { FormationSlot } from '../../../shared/model/formation';
import type { Side } from '../../../shared/model/match';
import type { PitchSpace } from '../PitchSpace';
import type { Mover } from './TeamShape';

export interface PlannerTeammate<A extends Mover> {
  actor: A;
  slot: FormationSlot;
  /** Where the teammate is heading (the pass is played into their path). */
  target: Vector3;
}

export interface PlannerContext<A extends Mover> {
  space: PitchSpace;
  side: Side;
  holder: Mover;
  holderRole: FormationSlot['role'];
  teammates: readonly PlannerTeammate<A>[];
  opponents: readonly Mover[];
  /** The team's mentality slider, −100 … 100: attack-minded teams look forward more. */
  mentality: number;
}

export type BallPlan<A extends Mover> =
  | { kind: 'pass'; receiver: A; point: Vector3; durationMs: number; height: number }
  | { kind: 'carry'; point: Vector3; durationMs: number }
  | { kind: 'hold' };

/** A pass this short or long is not worth considering (metres). */
const MIN_PASS = 4;
const MAX_PASS = 32;
/** Passes around this length are the most comfortable. */
const IDEAL_PASS = 13;
/** An opponent this close to the passing lane can cut the ball out (metres). */
const LANE_DANGER = 3;
/** Pass speed on the grass, metres per second. */
const PASS_SPEED = 17;

/**
 * Decides what the player on the ball does while the managers think: pass, carry the ball
 * into space, or keep it. Every option is scored like a coach would — is the receiver free,
 * is the lane safe, does it move us forward, is it a comfortable distance — and the best one
 * is played, with a little personality so the same pattern doesn't repeat forever.
 */
export class BallPlanner {
  private lastPasser: Mover | null = null;

  plan<A extends Mover>(ctx: PlannerContext<A>): BallPlan<A> {
    const pressure = this.nearestOpponent(ctx.holder.position, ctx.opponents);
    const carry = this.carryOption(ctx, pressure);

    let best: { score: number; plan: BallPlan<A> } | null = carry;
    for (const mate of ctx.teammates) {
      const option = this.passOption(ctx, mate, pressure);
      if (option && (!best || option.score > best.score)) best = option;
    }
    if (!best) return { kind: 'hold' };
    const chosen = best.plan;
    if (chosen.kind === 'pass') this.lastPasser = ctx.holder;
    return chosen;
  }

  /** How long the carrier keeps the ball before the next decision: quick under pressure. */
  thinkingTime(ctx: PlannerContext<Mover>): number {
    const pressure = this.nearestOpponent(ctx.holder.position, ctx.opponents);
    return pressure < 4 ? MathUtils.randFloat(450, 750) : MathUtils.randFloat(1000, 1700);
  }

  private passOption<A extends Mover>(ctx: PlannerContext<A>, mate: PlannerTeammate<A>, pressure: number): { score: number; plan: BallPlan<A> } | null {
    const from = ctx.holder.position;
    const point = mate.target.clone().setY(0);
    const distance = point.distanceTo(from);
    if (distance < MIN_PASS || distance > MAX_PASS) return null;

    const openness = MathUtils.clamp(this.nearestOpponent(point, ctx.opponents) / 7, 0, 1);
    let laneRisk = 0;
    for (const opponent of ctx.opponents) {
      const d = distanceToSegment(opponent.position, from, point);
      if (d < LANE_DANGER) laneRisk = Math.max(laneRisk, 1 - d / LANE_DANGER);
    }
    const progress = ctx.space.toTeam(ctx.side, point).ny - ctx.space.toTeam(ctx.side, from).ny;
    const comfort = Math.exp(-(((distance - IDEAL_PASS) / 11) ** 2));
    const ambition = 1.1 + (ctx.mentality / 100) * 0.6;

    let score = openness * 1.1 - laneRisk * 1.7 + comfort * 0.5 + progress * ambition * 2.2;
    // Under pressure a safe ball back is welcome; otherwise the keeper is a last resort.
    if (mate.slot.role === 'GK') score -= pressure < 4 ? 0.2 : 0.9;
    if (pressure < 4 && progress < 0) score += 0.25;
    if (mate.actor === this.lastPasser) score -= 0.35;
    score += Math.random() * 0.15;

    const durationMs = Math.max(420, (distance / PASS_SPEED) * 1000);
    // Long or crowded-lane passes go in the air.
    const height = distance > 20 || laneRisk > 0.5 ? MathUtils.clamp(distance / 9, 1.5, 3.2) : 0;
    return { score, plan: { kind: 'pass', receiver: mate.actor, point, durationMs, height } };
  }

  /** Run with the ball when there is grass in front of the carrier and nobody closing in. */
  private carryOption<A extends Mover>(ctx: PlannerContext<A>, pressure: number): { score: number; plan: BallPlan<A> } | null {
    if (ctx.holderRole === 'GK' || pressure < 5) return null;
    const at = ctx.space.toTeam(ctx.side, ctx.holder.position);
    if (at.ny > 0.74) return null;
    const ahead = ctx.space.toWorld(ctx.side, MathUtils.clamp(at.nx * 0.85, -0.85, 0.85), Math.min(0.78, at.ny + 0.13));
    const room = MathUtils.clamp(this.nearestOpponent(ahead, ctx.opponents) / 9, 0, 1);
    if (room < 0.45) return null;
    const distance = ahead.distanceTo(ctx.holder.position);
    const score = 0.35 + room * 0.6 + (ctx.mentality / 100) * 0.15 + Math.random() * 0.15;
    return { score, plan: { kind: 'carry', point: ahead, durationMs: (distance / 6) * 1000 } };
  }

  private nearestOpponent(point: Vector3, opponents: readonly Mover[]): number {
    let nearest = Infinity;
    for (const opponent of opponents) nearest = Math.min(nearest, opponent.position.distanceTo(point));
    return nearest;
  }
}

const segment = new Vector3();
const offset = new Vector3();

/** Distance (on the ground) from `point` to the segment a–b. */
export function distanceToSegment(point: Vector3, a: Vector3, b: Vector3): number {
  segment.subVectors(b, a).setY(0);
  offset.subVectors(point, a).setY(0);
  const lengthSq = segment.lengthSq();
  const t = lengthSq > 0 ? MathUtils.clamp(offset.dot(segment) / lengthSq, 0, 1) : 0;
  return offset.addScaledVector(segment, -t).length();
}
