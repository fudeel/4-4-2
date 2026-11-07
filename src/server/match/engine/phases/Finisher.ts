import type { RollStage } from '../../../../shared/model/match';
import type { MatchPlayer } from '../../model/MatchPlayer';
import type { ActionContext } from '../ActionContext';
import type { PhaseKind } from '../modifiers';
import { SKILLS, clamp, type AttributeWeights } from '../RatingCalculator';

export interface ShotSpec {
  shooter: MatchPlayer;
  assister: MatchPlayer | null;
  /** 0–1: how good the chance is. */
  quality: number;
  skill: AttributeWeights;
  stage: Extract<RollStage, 'shot' | 'penalty' | 'free_kick'>;
  /** Base chance a defender (or the wall) blocks the shot; 0 = unblockable. */
  baseBlockChance: number;
  /** Base chance to hit the target before the shooter's skill is added. */
  accuracyBase: number;
  /** Probability of beating an equal goalkeeper. */
  goalBase: number;
  /** Overrides for set pieces such as penalties. */
  accuracy?: number;
  goalChance?: (shot: number, keeper: number) => number;
  eventKind?: 'shot' | 'header';
  /** Whether a save or block can lead to a corner. */
  allowCorner?: boolean;
}

/** Resolves any attempt on goal: block → accuracy → goalkeeper. Shared by open play and set pieces. */
export class Finisher {
  resolve(ctx: ActionContext, spec: ShotSpec): PhaseKind | null {
    const shooterFp = ctx.fieldPlayerOf(spec.shooter);
    if (!shooterFp) return null;
    const { shooter, quality } = spec;
    const keeperFp = ctx.defense.goalkeeper();
    const shotScore = ctx.ratings.playerScore(shooterFp, ctx.attackSide, spec.skill, spec.stage);
    const keeperScore = keeperFp ? ctx.ratings.playerScore(keeperFp, ctx.defenseSide, SKILLS.goalkeeping, spec.stage) : 15;

    const blockerFp = spec.baseBlockChance > 0 ? ctx.pick(ctx.defense, { DEF: 1, MID: 0.5, FWD: 0.1 }, SKILLS.blocking) : null;
    const blockScore = blockerFp ? ctx.ratings.playerScore(blockerFp, ctx.defenseSide, SKILLS.blocking, 'block') : 0;
    const blockChance = blockerFp ? clamp(spec.baseBlockChance + (blockScore - 60) / 300, 0.03, 0.3) : 0;
    const accuracy = spec.accuracy ?? clamp(spec.accuracyBase + shotScore / 300 + quality * 0.2, 0.2, 0.92);
    const goalChance = spec.goalChance
      ? spec.goalChance(shotScore, keeperScore)
      : clamp(ctx.ratings.contest(shotScore * (0.75 + 0.5 * quality), keeperScore, spec.goalBase, 0.9, 0.05, 0.9) + 0.25 * (quality - 0.5), 0.04, 0.92);

    ctx.xg +=
      (1 - (blockerFp ? ctx.adjustedChance('block', blockChance, ctx.defenseSide) : 0)) *
      ctx.adjustedChance('on_target', accuracy, ctx.attackSide) *
      ctx.adjustedChance(spec.stage, goalChance, ctx.attackSide);

    shooter.shots += 1;
    ctx.attack.stats.shots += 1;
    const kind = spec.eventKind ?? 'shot';
    const shotText = ctx.commentary.line(kind === 'header' ? 'header' : 'shot', shooter);
    const canCorner = (spec.allowCorner ?? true) && ctx.cornersTaken < 1;

    if (blockerFp) {
      const block = ctx.roll('block', 'Block', blockChance, ctx.defenseSide);
      if (block.success) {
        ctx.emit({ kind, side: ctx.attackSide, actorId: shooter.id, text: shotText, shotResult: 'blocked' });
        ctx.emit({ kind: 'block', side: ctx.defenseSide, actorId: blockerFp.player.id, targetId: shooter.id, text: ctx.commentary.line('block', blockerFp.player), roll: block });
        blockerFp.player.adjustRating(0.2);
        ctx.outcome = 'blocked';
        ctx.momentumShift += 2;
        return canCorner && ctx.rng.chance(0.4) ? 'corner' : null;
      }
    }

    const aim = ctx.roll('on_target', 'On target', accuracy, ctx.attackSide);
    if (!aim.success) {
      ctx.emit({ kind, side: ctx.attackSide, actorId: shooter.id, text: shotText, shotResult: 'missed' });
      ctx.emit({ kind: 'miss', side: ctx.attackSide, actorId: shooter.id, text: ctx.commentary.line('miss', shooter), roll: aim });
      shooter.adjustRating(-0.1);
      ctx.outcome = 'missed';
      ctx.momentumShift += 2;
      return null;
    }

    ctx.attack.stats.shotsOnTarget += 1;
    const finish = ctx.roll(spec.stage, 'Beat the keeper', goalChance, ctx.attackSide);
    if (finish.success) {
      ctx.emit({ kind, side: ctx.attackSide, actorId: shooter.id, text: shotText, shotResult: 'goal' });
      ctx.scoreGoal(shooter, spec.assister);
      const assister = spec.assister && spec.assister !== shooter ? spec.assister : null;
      ctx.emit({
        kind: 'goal', side: ctx.attackSide, actorId: shooter.id, targetId: assister?.id,
        text: assister ? ctx.commentary.line('goalAssisted', shooter, assister) : ctx.commentary.line('goal', shooter),
        roll: finish,
      });
      return null;
    }

    ctx.emit({ kind, side: ctx.attackSide, actorId: shooter.id, text: shotText, shotResult: 'saved' });
    const parried = canCorner && ctx.rng.chance(0.35);
    if (keeperFp) {
      keeperFp.player.saves += 1;
      keeperFp.player.adjustRating(0.3);
    }
    ctx.emit({
      kind: 'save', side: ctx.defenseSide, actorId: keeperFp?.player.id, targetId: shooter.id,
      text: ctx.commentary.line(parried || quality > 0.6 ? 'save' : 'saveHeld', keeperFp?.player), roll: finish,
    });
    ctx.outcome = 'saved';
    ctx.momentumShift += 3;
    return parried ? 'corner' : null;
  }
}
