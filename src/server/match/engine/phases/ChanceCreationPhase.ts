import type { ActionContext } from '../ActionContext';
import type { PhaseKind } from '../modifiers';
import { PROFILES, SKILLS, clamp } from '../RatingCalculator';
import type { ActionPhase } from './ActionPhase';

/** Final third: can the attackers carve out a shooting chance, and how good is it? */
export class ChanceCreationPhase implements ActionPhase {
  readonly kind = 'chance' as const;

  play(ctx: ActionContext): PhaseKind | null {
    const creator = ctx.carrier ?? ctx.pick(ctx.attack, { DEF: 0.2, MID: 1, FWD: 0.6 }, SKILLS.passing)?.player;
    if (!creator) return null;
    const shooter =
      ctx.modifiers.chooseShooter(ctx) ??
      ctx.pick(ctx.attack, { DEF: 0.1, MID: 0.45, FWD: 1 }, SKILLS.shooting, [creator])?.player ??
      creator;
    const marker = ctx.pick(ctx.defense, { DEF: 1, MID: 0.5, FWD: 0.1 }, { defending: 1 })?.player ?? null;

    const attack = ctx.ratings.teamStrength(ctx.attack, PROFILES.chanceAttack, 'chance');
    const defense = ctx.ratings.teamStrength(ctx.defense, PROFILES.chanceDefense, 'chance');
    const chance = ctx.ratings.contest(attack, defense, 0.68, 1.2, 0.15, 0.92);
    const roll = ctx.roll('chance', 'Create a chance', chance, ctx.attackSide);

    if (roll.success) {
      const oneOnOne = ctx.flags.oneOnOne ? 0.3 : 0;
      ctx.chanceQuality = clamp(0.45 + (roll.chance - roll.roll) * 0.9 + ctx.modifiers.chanceQualityBonus(ctx) + oneOnOne, 0.2, 1);
      ctx.shooter = shooter;
      ctx.creator = creator === shooter ? null : creator;
      ctx.attack.stats.chancesCreated += 1;
      ctx.momentumShift += 7;
      creator.adjustRating(0.15);

      if (creator === shooter || ctx.flags.longBall) {
        ctx.emit({ kind: 'dribble', side: ctx.attackSide, actorId: shooter.id, targetId: marker?.id, text: ctx.commentary.line('soloRun', shooter, marker), roll });
      } else {
        const key = ctx.rng.chance(0.5) ? 'throughBall' : 'cross';
        ctx.emit({ kind: 'through_ball', side: ctx.attackSide, actorId: creator.id, targetId: shooter.id, text: ctx.commentary.line(key, creator, shooter), roll });
      }
      ctx.modifiers.afterPhase('chance', true, ctx);
      return 'shot';
    }

    ctx.modifiers.afterPhase('chance', false, ctx);
    const situation = ctx.rng.next();
    const foulRate = ctx.foulRate();
    const foulChance = 0.13 * foulRate;

    if (marker && situation < foulChance) {
      const inBox = ctx.rng.chance(0.3);
      const booking = ctx.book(marker, { yellowChance: inBox ? 0.5 : 0.35 });
      ctx.defense.stats.fouls += 1;
      const text = inBox
        ? ctx.commentary.line('foulInBox', marker, creator)
        : `${ctx.commentary.line('foul', marker, creator)} Free kick in a dangerous position.`;
      ctx.emit({ kind: 'foul', side: ctx.defenseSide, actorId: marker.id, targetId: creator.id, text, roll, booking });
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
      actorId: marker?.id,
      targetId: creator.id,
      text: tackled ? ctx.commentary.line('tackle', marker, creator) : ctx.commentary.line('clearance', marker),
      roll,
    });
    marker?.adjustRating(0.15);
    ctx.outcome = 'defended';
    ctx.momentumShift -= 5;

    // Too many bodies committed forward: the defence wins it and breaks into the space behind.
    if (ctx.exposedToCounter()) {
      ctx.counterAttack = true;
      ctx.emit({ kind: 'counter', side: ctx.defenseSide, actorId: marker?.id, text: ctx.commentary.line('counterExposed', marker) });
    }
    return null;
  }
}
