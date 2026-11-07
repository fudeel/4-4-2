import type { DiceRoll } from '../../../../shared/model/match';
import type { MatchPlayer } from '../../model/MatchPlayer';
import type { ActionContext } from '../ActionContext';
import type { PhaseKind } from '../modifiers';
import { PROFILES, SKILLS } from '../RatingCalculator';
import type { ActionPhase } from './ActionPhase';

/** Midfield battle: can the attacking team get the ball into the final third? */
export class BuildUpPhase implements ActionPhase {
  readonly kind = 'buildup' as const;

  play(ctx: ActionContext): PhaseKind | null {
    const carrierFp = ctx.pick(ctx.attack, { DEF: 0.35, MID: 1, FWD: 0.2 }, SKILLS.passing);
    const presserFp = ctx.pick(ctx.defense, { DEF: 0.4, MID: 1, FWD: 0.6 }, SKILLS.pressing);
    if (!carrierFp) return null;
    const carrier = carrierFp.player;
    ctx.carrier = carrier;
    ctx.emit({ kind: 'buildup', side: ctx.attackSide, actorId: carrier.id, text: ctx.commentary.line('buildup', carrier) });

    const attack = ctx.ratings.teamStrength(ctx.attack, PROFILES.buildUpAttack, 'buildup');
    const defense = ctx.ratings.teamStrength(ctx.defense, PROFILES.buildUpDefense, 'buildup');
    const chance = ctx.ratings.contest(attack, defense, 0.72, 1.1, 0.2, 0.94);
    const roll = ctx.roll('buildup', 'Build-up', chance, ctx.attackSide);

    if (roll.success) {
      this.progress(ctx, carrierFp.player, presserFp?.player ?? null, roll);
      ctx.modifiers.afterPhase('buildup', true, ctx);
      return 'chance';
    }

    // A foul in midfield keeps the move alive: free kick, play on.
    if (presserFp && ctx.rng.chance(0.12)) {
      const booking = ctx.book(presserFp.player, { yellowChance: 0.25 });
      ctx.defense.stats.fouls += 1;
      ctx.emit({
        kind: 'foul', side: ctx.defenseSide, actorId: presserFp.player.id, targetId: carrier.id,
        text: `${ctx.commentary.line('foul', presserFp.player, carrier)} Free kick, they play on.`, roll, booking,
      });
      ctx.modifiers.afterPhase('buildup', true, ctx);
      return 'chance';
    }

    const winner = presserFp?.player ?? null;
    const tackled = ctx.rng.chance(0.5);
    ctx.emit({
      kind: tackled ? 'tackle' : 'interception',
      side: ctx.defenseSide,
      actorId: winner?.id,
      targetId: carrier.id,
      text: tackled ? ctx.commentary.line('tackle', winner, carrier) : ctx.commentary.line('interception', winner),
      roll,
    });
    winner?.adjustRating(0.15);
    carrier.adjustRating(-0.1);
    ctx.outcome = 'defended';
    ctx.momentumShift -= 6;

    // Winning the ball convincingly springs a counter-attack.
    if (roll.roll - roll.chance > 0.3) ctx.counterAttack = true;
    ctx.modifiers.afterPhase('buildup', false, ctx);
    if (ctx.counterAttack) {
      ctx.emit({ kind: 'counter', side: ctx.defenseSide, actorId: winner?.id, text: ctx.commentary.line('counter') });
    }
    return null;
  }

  private progress(ctx: ActionContext, carrier: MatchPlayer, presser: MatchPlayer | null, roll: DiceRoll): void {
    const receiverFp = ctx.pick(ctx.attack, { DEF: 0.1, MID: 0.6, FWD: 1 }, SKILLS.passing, [carrier]);
    const receiver = receiverFp?.player ?? carrier;
    if (presser && ctx.rng.chance(0.45)) {
      ctx.emit({ kind: 'dribble', side: ctx.attackSide, actorId: carrier.id, targetId: presser.id, text: ctx.commentary.line('dribble', carrier, presser), roll });
      presser.adjustRating(-0.05);
    } else {
      ctx.emit({ kind: 'pass', side: ctx.attackSide, actorId: carrier.id, targetId: receiver.id, text: ctx.commentary.line('pass', carrier, receiver), roll });
      ctx.carrier = receiver;
    }
    carrier.adjustRating(0.1);
    ctx.momentumShift += 5;
  }
}
