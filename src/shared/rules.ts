export interface MatchRules {
  playersPerSide: number;
  /** In-game minutes covered by one turn (one action). */
  minutesPerTurn: number;
  halfLengthMinutes: number;
  /** Time each manager has to pick a card or skip. */
  planningSeconds: number;
  halfTimeSeconds: number;
  maxSubstitutions: number;
  /** Maximum cards in hand. */
  handLimit: number;
  /** Cards a manager may play in a single turn. */
  cardsPerTurn: number;
  /** Each manager draws one card every N turns (hands are refilled at half-time). */
  drawEveryTurns: number;
  /** Extra pause after an action's animation before the next turn starts. */
  resolutionBufferMs: number;
}

export const DEFAULT_RULES: MatchRules = {
  playersPerSide: 6,
  minutesPerTurn: 5,
  halfLengthMinutes: 45,
  planningSeconds: 20,
  halfTimeSeconds: 45,
  maxSubstitutions: 3,
  handLimit: 3,
  cardsPerTurn: 1,
  drawEveryTurns: 2,
  resolutionBufferMs: 900,
};

export function turnsPerHalf(rules: MatchRules): number {
  return Math.round(rules.halfLengthMinutes / rules.minutesPerTurn);
}

export function totalTurns(rules: MatchRules): number {
  return turnsPerHalf(rules) * 2;
}
