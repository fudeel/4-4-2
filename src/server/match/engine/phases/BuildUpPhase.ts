import type { DiceRoll } from '../../../../shared/model/match';
import type { Position } from '../../../../shared/model/player';
import type { FieldPlayer } from '../../model/TeamState';
import type { ActionContext } from '../ActionContext';
import type { PhaseKind } from '../modifiers';
import { PROFILES, SKILLS, clamp } from '../RatingCalculator';
import type { ActionPhase } from './ActionPhase';

/** How keen a carrier is to find each line with the ball: forwards first. */
const OUTLET_PREFERENCE: Partial<Record<Position, number>> = { DEF: 0.15, MID: 0.7, FWD: 1 };

/** Midfield battle: can the attacking team get the ball into the final third? */
export class BuildUpPhase implements ActionPhase {
  readonly kind = 'buildup' as const;

  play(ctx: ActionContext): PhaseKind | null {
    const carrierFp = ctx.pick(ctx.attack, { DEF: 0.35, MID: 1, FWD: 0.2 }, SKILLS.passing);
    if (!carrierFp) return null;
    const carrier = carrierFp.player;
    // The opponent whose zone the carrier is in steps up to press him.
    const presserFp = ctx.opponentOf(carrier, SKILLS.pressing);
    ctx.carrier = carrier;
    ctx.emit({ kind: 'buildup', side: ctx.attackSide, actorId: carrier.id, text: ctx.commentary.line('buildup', carrier) });

    const attack = ctx.ratings.teamStrength(ctx.attack, PROFILES.buildUpAttack, 'buildup');
    const defense = ctx.ratings.teamStrength(ctx.defense, PROFILES.buildUpDefense, 'buildup');
    const chance = ctx.ratings.contest(attack, defense, 0.72, 1.1, 0.2, 0.94);
    const roll = ctx.roll('buildup', 'Build-up', chance, ctx.attackSide);

    if (roll.success) {
      this.progress(ctx, carrierFp, presserFp, roll);
      ctx.modifiers.afterPhase('buildup', true, ctx);
      return 'chance';
    }

    // A foul in midfield keeps the move alive: free kick, play on. Defence-minded teams dive in more.
    const foulRate = ctx.foulRate();
    if (presserFp && ctx.rng.chance(0.12 * foulRate)) {
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
    // Strong, aggressive defenders go to ground; quick, clever ones read the pass.
    const style = presserFp
      ? (ctx.ratings.playerScore(presserFp, ctx.defenseSide, { physical: 1 }, 'buildup') - ctx.ratings.playerScore(presserFp, ctx.defenseSide, { pace: 0.6, passing: 0.4 }, 'buildup')) / 80
      : 0;
    const tackled = ctx.rng.chance(clamp(0.5 * foulRate + style, 0.2, 0.85));
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

    // Winning the ball convincingly — or against a team caught upfield — springs a counter-attack.
    if (roll.roll - roll.chance > 0.3 || ctx.exposedToCounter()) ctx.counterAttack = true;
    ctx.modifiers.afterPhase('buildup', false, ctx);
    if (ctx.counterAttack) {
      ctx.emit({ kind: 'counter', side: ctx.defenseSide, actorId: winner?.id, text: ctx.commentary.line('counter') });
    }
    return null;
  }

  /**
   * The carrier beat the press. Does he take his man on or play the pass? He does what he's
   * better at against this particular opponent — a dribbler beats a slow marker, a passer
   * finds the free man.
   */
  private progress(ctx: ActionContext, carrierFp: FieldPlayer, presserFp: FieldPlayer | null, roll: DiceRoll): void {
    const carrier = carrierFp.player;
    const outlet = this.outlet(ctx, carrierFp);
    let dribble = presserFp !== null && outlet === null;
    if (presserFp && outlet) {
      const beatHim = (ctx.ratings.playerScore(carrierFp, ctx.attackSide, { dribbling: 0.7, pace: 0.3 }, 'buildup') -
        ctx.ratings.playerScore(presserFp, ctx.defenseSide, SKILLS.pressing, 'buildup')) / 30 - 0.25;
      const findHim = (ctx.ratings.playerScore(carrierFp, ctx.attackSide, SKILLS.passing, 'buildup') - 65) / 25 + (ctx.freedom(outlet.player) - 0.85);
      dribble = beatHim + (ctx.rng.next() - 0.5) * 0.5 > findHim;
    }

    if (dribble && presserFp) {
      const presser = presserFp.player;
      ctx.emit({ kind: 'dribble', side: ctx.attackSide, actorId: carrier.id, targetId: presser.id, text: ctx.commentary.line('dribble', carrier, presser), roll });
      presser.adjustRating(-0.05);
    } else {
      const receiver = outlet?.player ?? carrier;
      ctx.emit({ kind: 'pass', side: ctx.attackSide, actorId: carrier.id, targetId: receiver.id, text: ctx.commentary.line('pass', carrier, receiver), roll });
      ctx.carrier = receiver;
    }
    carrier.adjustRating(0.1);
    ctx.momentumShift += 5;
  }

  /** The pass that moves the ball on: forwards before midfielders, free players before marked ones. */
  private outlet(ctx: ActionContext, carrierFp: FieldPlayer): FieldPlayer | null {
    const options = ctx.attack.outfield().filter(fp => fp.player !== carrierFp.player);
    if (options.length === 0) return null;
    return ctx.rng.weighted(options, fp =>
      (OUTLET_PREFERENCE[fp.role] ?? 0) *
      Math.pow(Math.max(ctx.ratings.playerScore(fp, ctx.attackSide, SKILLS.passing, 'buildup'), 1), 1.2) *
      Math.pow(ctx.freedom(fp.player), 2.5));
  }
}
