import type { ChanceStyle } from '../../../../shared/model/match';
import type { Position } from '../../../../shared/model/player';
import type { MatchPlayer } from '../../model/MatchPlayer';
import type { FieldPlayer } from '../../model/TeamState';
import type { ActionContext } from '../ActionContext';
import type { CommentaryKey } from '../CommentaryWriter';
import type { PhaseKind } from '../modifiers';
import { PROFILES, SKILLS, clamp, type AttributeWeights } from '../RatingCalculator';
import type { ActionPhase } from './ActionPhase';

/** Who gets on the end of chances: forwards, then midfielders arriving late, rarely defenders. */
const FINISHER_ROLES: Partial<Record<Position, number>> = { DEF: 0.1, MID: 0.45, FWD: 1 };
/** How much a well-suited way of creating the chance improves it (and a poor one hurts it). */
const STYLE_QUALITY = 0.03;

const STYLE_COMMENTARY: Record<ChanceStyle, CommentaryKey> = {
  through: 'throughBall',
  cross: 'cross',
  cutback: 'cutback',
  solo: 'soloRun',
  long_shot: 'longShot',
};

/** Final third: can the attackers carve out a shooting chance, and how good is it? */
export class ChanceCreationPhase implements ActionPhase {
  readonly kind = 'chance' as const;

  play(ctx: ActionContext): PhaseKind | null {
    const creator = ctx.carrier ?? ctx.pick(ctx.attack, { DEF: 0.2, MID: 1, FWD: 0.6 }, SKILLS.passing)?.player;
    const creatorFp = creator ? ctx.attack.fieldPlayer(creator.id) : undefined;
    if (!creator || !creatorFp) return null;
    const shooter = ctx.modifiers.chooseShooter(ctx) ?? this.finisher(ctx, creator) ?? creator;
    const shooterFp = ctx.attack.fieldPlayer(shooter.id) ?? creatorFp;
    // The defenders responsible for the shooter, and for the man on the ball.
    const markerFp = ctx.opponentOf(shooter, { defending: 1 }, ['DEF', 'MID']);
    const marker = markerFp?.player ?? null;
    const closer = ctx.opponentOf(creator, SKILLS.pressing) ?? markerFp;

    const attack = ctx.ratings.teamStrength(ctx.attack, PROFILES.chanceAttack, 'chance');
    const defense = ctx.ratings.teamStrength(ctx.defense, PROFILES.chanceDefense, 'chance');
    const chance = ctx.ratings.contest(attack, defense, 0.68, 1.2, 0.15, 0.92);
    const roll = ctx.roll('chance', 'Create a chance', chance, ctx.attackSide);

    if (roll.success) {
      const { style, fit } = creator === shooter || ctx.flags.longBall
        ? { style: 'solo' as const, fit: 0 }
        : this.chooseStyle(ctx, creatorFp, shooterFp, markerFp, closer);
      const oneOnOne = ctx.flags.oneOnOne ? 0.3 : 0;
      ctx.chanceQuality = clamp(0.45 + (roll.chance - roll.roll) * 0.9 + ctx.modifiers.chanceQualityBonus(ctx) + oneOnOne + fit * STYLE_QUALITY, 0.2, 1);
      ctx.flags.chanceStyle = style;
      ctx.shooter = shooter;
      ctx.creator = creator === shooter ? null : creator;
      ctx.attack.stats.chancesCreated += 1;
      ctx.momentumShift += 7;
      creator.adjustRating(0.15);

      const text = style === 'solo'
        ? ctx.commentary.line('soloRun', shooter, marker)
        : ctx.commentary.line(STYLE_COMMENTARY[style], creator, shooter);
      const kind = style === 'solo' ? 'dribble' : style === 'long_shot' ? 'pass' : 'through_ball';
      const actor = style === 'solo' ? shooter : creator;
      ctx.emit({ kind, side: ctx.attackSide, actorId: actor.id, targetId: style === 'solo' ? marker?.id : shooter.id, text, roll, style });
      ctx.modifiers.afterPhase('chance', true, ctx);
      return 'shot';
    }

    ctx.modifiers.afterPhase('chance', false, ctx);
    const defender = closer?.player ?? marker;
    const situation = ctx.rng.next();
    const foulRate = ctx.foulRate();
    const foulChance = 0.13 * foulRate;

    if (defender && situation < foulChance) {
      const inBox = ctx.rng.chance(0.3);
      const booking = ctx.book(defender, { yellowChance: inBox ? 0.5 : 0.35 });
      ctx.defense.stats.fouls += 1;
      const text = inBox
        ? ctx.commentary.line('foulInBox', defender, creator)
        : `${ctx.commentary.line('foul', defender, creator)} Free kick in a dangerous position.`;
      ctx.emit({ kind: 'foul', side: ctx.defenseSide, actorId: defender.id, targetId: creator.id, text, roll, booking });
      ctx.shooter = null;
      ctx.momentumShift += inBox ? 8 : 3;
      return inBox ? 'penalty' : 'free_kick';
    }

    if (situation < foulChance + 0.2) {
      ctx.emit({ kind: 'clearance', side: ctx.defenseSide, actorId: marker?.id, text: ctx.commentary.line('clearedForCorner', marker), roll });
      return 'corner';
    }

    const tackled = ctx.rng.chance(Math.min(0.8, 0.5 * foulRate));
    ctx.emit({
      kind: tackled ? 'tackle' : 'clearance',
      side: ctx.defenseSide,
      actorId: defender?.id,
      targetId: creator.id,
      text: tackled ? ctx.commentary.line('tackle', defender, creator) : ctx.commentary.line('clearance', defender),
      roll,
    });
    defender?.adjustRating(0.15);
    ctx.outcome = 'defended';
    ctx.momentumShift -= 5;

    // Too many bodies committed forward: the defence wins it and breaks into the space behind.
    if (ctx.exposedToCounter()) {
      ctx.counterAttack = true;
      ctx.emit({ kind: 'counter', side: ctx.defenseSide, actorId: defender?.id, text: ctx.commentary.line('counterExposed', defender) });
    }
    return null;
  }

  /** The chance falls to the best-placed finisher: good at shooting, and not tightly marked. */
  private finisher(ctx: ActionContext, creator: MatchPlayer): MatchPlayer | null {
    const options = ctx.attack.outfield().filter(fp => fp.player !== creator);
    if (options.length === 0) return null;
    return ctx.rng.weighted(options, fp =>
      (FINISHER_ROLES[fp.role] ?? 0) *
      Math.pow(Math.max(ctx.ratings.playerScore(fp, ctx.attackSide, SKILLS.shooting, 'shot'), 1) / 60, 2.5) *
      Math.pow(ctx.freedom(fp.player), 2)).player;
  }

  /**
   * How the creator makes the chance — whichever suits these players against these defenders:
   * a through ball for a quick runner, a cross for a header from a wide creator, a cut-back
   * after beating his man, or a shot from distance at a packed defence. `fit` (−1…1) is how
   * well the chosen option suits them.
   */
  private chooseStyle(ctx: ActionContext, creator: FieldPlayer, shooter: FieldPlayer, marker: FieldPlayer | null, closer: FieldPlayer | null): { style: ChanceStyle; fit: number } {
    const A = ctx.attackSide;
    const D = ctx.defenseSide;
    const us = (fp: FieldPlayer, skill: AttributeWeights, stage: 'chance' | 'aerial' | 'shot' = 'chance') => ctx.ratings.playerScore(fp, A, skill, stage);
    const them = (fp: FieldPlayer | null, skill: AttributeWeights, stage: 'chance' | 'aerial' = 'chance') => (fp ? ctx.ratings.playerScore(fp, D, skill, stage) : 40);
    const wide = Math.abs(ctx.spotOf(ctx.attack, creator).x) >= 0.35;
    const packed = Math.max(0, -ctx.defense.mentality / 100);

    const options: Record<Exclude<ChanceStyle, 'solo'>, number> = {
      through: (us(creator, { passing: 1 }) - 66) / 22 + (us(shooter, { pace: 1 }) - them(marker, { pace: 1 })) / 28,
      cross: wide
        ? (us(creator, { passing: 1 }) - 68) / 26 + (us(shooter, SKILLS.aerialDuel, 'aerial') - them(marker, SKILLS.aerialDuel, 'aerial')) / 22 + 0.1
        : -Infinity,
      cutback: (us(creator, { dribbling: 0.7, pace: 0.3 }) - them(closer, SKILLS.pressing)) / 34 + (us(shooter, SKILLS.shooting, 'shot') - 70) / 30 - 0.25,
      long_shot: (us(shooter, SKILLS.shooting, 'shot') - 74) / 18 + packed * 0.5 - 0.15,
    };
    let best: { style: ChanceStyle; fit: number; score: number } = { style: 'through', fit: 0, score: -Infinity };
    for (const [style, value] of Object.entries(options) as [ChanceStyle, number][]) {
      const score = value + (ctx.rng.next() - 0.5) * 0.3;
      if (score > best.score) best = { style, fit: clamp(value, -1, 1), score };
    }
    return { style: best.style, fit: best.fit };
  }
}
