import type { Side } from '../../../shared/model/match';
import { mentalityEffects } from '../../../shared/model/tactics';
import type { ActionModifier } from './modifiers';

/**
 * Turns a team's mentality slider into a modifier for this turn's action.
 * Attack-minded teams create more and better chances but leave space behind them;
 * defence-minded teams are harder to break down but dive into more tackles (and fouls).
 */
export function mentalityModifier(owner: Side, mentality: number, attackingSide: Side): ActionModifier {
  const effects = mentalityEffects(mentality);
  const attacking = owner === attackingSide;
  return {
    owner,
    teamMultiplier: (stage, side) => {
      if (side !== owner || (stage !== 'buildup' && stage !== 'chance')) return 1;
      return attacking ? effects.attack : effects.defense;
    },
    probabilityBonus: (stage, side) => (side === owner && stage === 'block' ? effects.blocks : 0),
    chanceQualityBonus: () => (attacking ? effects.chanceQuality : 0),
    foulMultiplier: side => (side === owner ? effects.fouls : 1),
    bookingBonus: side => (side === owner ? effects.bookings : 0),
    counterExposure: side => (side === owner ? effects.counterExposure : 0),
  };
}
