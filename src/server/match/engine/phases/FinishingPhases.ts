import type { MatchPlayer } from '../../model/MatchPlayer';
import type { ActionContext } from '../ActionContext';
import type { PhaseKind } from '../modifiers';
import { SKILLS, clamp } from '../RatingCalculator';
import type { ActionPhase } from './ActionPhase';
import { Finisher } from './Finisher';

/** Open-play shot from the chance created in the previous phase. */
export class ShotPhase implements ActionPhase {
  readonly kind = 'shot' as const;

  constructor(private readonly finisher: Finisher) {}

  play(ctx: ActionContext): PhaseKind | null {
    if (!ctx.shooter) return null;
    const open = { shooter: ctx.shooter, assister: ctx.creator, stage: 'shot' as const };
    switch (ctx.flags.chanceStyle) {
      case 'cross':
        // Met with the head: harder to place, but hard for defenders to block.
        return this.finisher.resolve(ctx, {
          ...open, quality: ctx.chanceQuality, skill: SKILLS.heading, eventKind: 'header',
          baseBlockChance: 0.06, accuracyBase: 0.3, goalBase: 0.47,
        });
      case 'long_shot':
        // From the edge of the box: bodies in the way and a keeper who sees it coming.
        return this.finisher.resolve(ctx, {
          ...open, quality: ctx.chanceQuality * 0.85, skill: SKILLS.shooting,
          baseBlockChance: 0.18, accuracyBase: 0.32, goalBase: 0.45,
        });
      default:
        return this.finisher.resolve(ctx, {
          ...open, quality: ctx.chanceQuality, skill: SKILLS.shooting,
          baseBlockChance: 0.1, accuracyBase: 0.34, goalBase: 0.47,
        });
    }
  }
}

export class PenaltyPhase implements ActionPhase {
  readonly kind = 'penalty' as const;

  constructor(private readonly finisher: Finisher) {}

  play(ctx: ActionContext): PhaseKind | null {
    const taker = ctx.modifiers.chooseShooter(ctx) ?? ctx.best(ctx.attack, SKILLS.shooting, ['FWD', 'MID', 'DEF'])?.player;
    if (!taker) return null;
    ctx.emit({ kind: 'penalty', side: ctx.attackSide, actorId: taker.id, text: ctx.commentary.line('penalty', taker) });
    return this.finisher.resolve(ctx, {
      shooter: taker,
      assister: null,
      quality: 0.9,
      skill: SKILLS.shooting,
      stage: 'penalty',
      baseBlockChance: 0,
      accuracyBase: 0,
      goalBase: 0,
      accuracy: 0.92,
      goalChance: (shot, keeper) => clamp(0.74 + (shot - keeper) / 250, 0.55, 0.92),
      allowCorner: false,
    });
  }
}

/** Wins an aerial duel in the box and heads at goal. Shared by corners and crossed free kicks. */
class AerialDelivery {
  constructor(private readonly finisher: Finisher) {}

  deliver(ctx: ActionContext, deliverer: MatchPlayer): PhaseKind | null {
    const attackerFp = ctx.pick(ctx.attack, { DEF: 0.8, MID: 0.5, FWD: 1 }, SKILLS.aerialDuel, [deliverer]);
    if (!attackerFp) return null;
    // Each attacker in the box has his marker: that's who he has to beat in the air.
    const defenderFp = ctx.opponentOf(attackerFp.player, SKILLS.aerialDuel);

    const attack = ctx.ratings.playerScore(attackerFp, ctx.attackSide, SKILLS.aerialDuel, 'aerial');
    const defense = defenderFp ? ctx.ratings.playerScore(defenderFp, ctx.defenseSide, SKILLS.aerialDuel, 'aerial') : 20;
    const duel = ctx.roll('aerial', 'Aerial duel', ctx.ratings.contest(attack, defense, 0.45, 1, 0.15, 0.8), ctx.attackSide);

    if (!duel.success) {
      ctx.emit({ kind: 'clearance', side: ctx.defenseSide, actorId: defenderFp?.player.id, targetId: attackerFp.player.id, text: ctx.commentary.line('aerialLost', defenderFp?.player), roll: duel });
      defenderFp?.player.adjustRating(0.1);
      ctx.outcome = 'cleared';
      return null;
    }

    return this.finisher.resolve(ctx, {
      shooter: attackerFp.player,
      assister: deliverer,
      quality: clamp(0.35 + (duel.chance - duel.roll) * 0.5, 0.25, 0.7),
      skill: SKILLS.heading,
      stage: 'shot',
      baseBlockChance: 0.06,
      accuracyBase: 0.22,
      goalBase: 0.3,
      eventKind: 'header',
      allowCorner: false,
    });
  }
}

export class CornerPhase implements ActionPhase {
  readonly kind = 'corner' as const;
  private readonly aerial: AerialDelivery;

  constructor(finisher: Finisher) {
    this.aerial = new AerialDelivery(finisher);
  }

  play(ctx: ActionContext): PhaseKind | null {
    const taker = ctx.best(ctx.attack, SKILLS.passing, ['MID', 'FWD', 'DEF'])?.player;
    if (!taker) return null;
    ctx.cornersTaken += 1;
    ctx.attack.stats.corners += 1;
    ctx.emit({ kind: 'corner', side: ctx.attackSide, actorId: taker.id, text: ctx.commentary.line('corner', taker) });
    return this.aerial.deliver(ctx, taker);
  }
}

export class FreeKickPhase implements ActionPhase {
  readonly kind = 'free_kick' as const;
  private readonly aerial: AerialDelivery;

  constructor(private readonly finisher: Finisher) {
    this.aerial = new AerialDelivery(finisher);
  }

  play(ctx: ActionContext): PhaseKind | null {
    const taker =
      ctx.modifiers.chooseShooter(ctx) ??
      ctx.best(ctx.attack, { shooting: 0.6, passing: 0.4 }, ['MID', 'FWD', 'DEF'])?.player;
    if (!taker) return null;

    if (ctx.rng.chance(0.4)) {
      ctx.emit({ kind: 'free_kick', side: ctx.attackSide, actorId: taker.id, text: ctx.commentary.line('freeKickDelivered', taker) });
      return this.aerial.deliver(ctx, taker);
    }

    ctx.emit({ kind: 'free_kick', side: ctx.attackSide, actorId: taker.id, text: ctx.commentary.line('freeKick', taker) });
    return this.finisher.resolve(ctx, {
      shooter: taker,
      assister: null,
      quality: 0.4,
      skill: { shooting: 0.7, passing: 0.3 },
      stage: 'free_kick',
      baseBlockChance: 0.15,
      accuracyBase: 0.18,
      goalBase: 0.26,
      allowCorner: true,
    });
  }
}
