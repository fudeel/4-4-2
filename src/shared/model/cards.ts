export type CardId =
  | 'tiki_taka'
  | 'through_ball'
  | 'power_shot'
  | 'long_ball'
  | 'talisman'
  | 'siege'
  | 'simulation'
  | 'high_press'
  | 'park_the_bus'
  | 'offside_trap'
  | 'tactical_foul'
  | 'keeper_heroics'
  | 'man_marking'
  | 'second_wind'
  | 'team_talk'
  | 'mind_games';

/** When a card may be played: while your team has the ball, while defending, or always. */
export type CardTiming = 'attack' | 'defense' | 'any';
export type CardRarity = 'common' | 'rare' | 'epic';

export interface CardDefinition {
  id: CardId;
  name: string;
  icon: string;
  timing: CardTiming;
  rarity: CardRarity;
  description: string;
}

export interface CardInstance {
  instanceId: string;
  cardId: CardId;
}

/** Numeric tuning shared by the engine and the card descriptions, so the text never lies. */
export const CARD_TUNING = {
  tikiTaka: { buildUpBonus: 0.3 },
  throughBall: { chanceBonus: 0.3 },
  powerShot: { shootingBonus: 0.25 },
  longBall: { chancePenalty: 0.1 },
  talisman: { statBonus: 0.2 },
  siege: { extraAttacks: 2, extraFatigue: 2 },
  simulation: { penaltyChance: 0.4 },
  highPress: { pressBonus: 0.3 },
  parkTheBus: { defenseBonus: 0.35, blockBonus: 0.08 },
  offsideTrap: { successChance: 0.45, vsLongBallBonus: 0.2, beatenQualityBonus: 0.3 },
  keeperHeroics: { keeperBonus: 0.3 },
  manMarking: { markPenalty: 0.3 },
  secondWind: { energy: 25 },
  teamTalk: { bonus: 0.1, turns: 3 },
} as const;

const pct = (value: number): string => `${Math.round(value * 100)}%`;
const T = CARD_TUNING;

export const CARD_DEFINITIONS: Record<CardId, CardDefinition> = {
  tiki_taka: {
    id: 'tiki_taka', name: 'Tiki-Taka', icon: '🔁', timing: 'attack', rarity: 'common',
    description: `Short passing carousel: +${pct(T.tikiTaka.buildUpBonus)} build-up strength.`,
  },
  through_ball: {
    id: 'through_ball', name: 'Through Ball', icon: '🎯', timing: 'attack', rarity: 'common',
    description: `Split the defence: +${pct(T.throughBall.chanceBonus)} chance creation.`,
  },
  power_shot: {
    id: 'power_shot', name: 'Power Shot', icon: '💥', timing: 'attack', rarity: 'common',
    description: `Hit it with everything: +${pct(T.powerShot.shootingBonus)} finishing.`,
  },
  long_ball: {
    id: 'long_ball', name: 'Long Ball', icon: '🚀', timing: 'attack', rarity: 'common',
    description: `Skip the midfield battle entirely, but −${pct(T.longBall.chancePenalty)} chance creation. Weak to the offside trap.`,
  },
  talisman: {
    id: 'talisman', name: 'Talisman', icon: '⭐', timing: 'attack', rarity: 'rare',
    description: `Your best attacker takes the shot with +${pct(T.talisman.statBonus)} to every stat.`,
  },
  siege: {
    id: 'siege', name: 'Siege', icon: '🏰', timing: 'attack', rarity: 'epic',
    description: `Pin them back: you also attack the next ${T.siege.extraAttacks} turns (3 attacks in a row). Your players tire faster.`,
  },
  simulation: {
    id: 'simulation', name: 'Simulation', icon: '🎭', timing: 'attack', rarity: 'rare',
    description: `Go down in the box: ${pct(T.simulation.penaltyChance)} to win a penalty. Otherwise the diver is booked and the attack ends.`,
  },
  high_press: {
    id: 'high_press', name: 'High Press', icon: '🐺', timing: 'defense', rarity: 'common',
    description: `+${pct(T.highPress.pressBonus)} pressing in midfield. Winning the ball there triggers a counter-attack.`,
  },
  park_the_bus: {
    id: 'park_the_bus', name: 'Park the Bus', icon: '🚌', timing: 'defense', rarity: 'common',
    description: `Everyone behind the ball: +${pct(T.parkTheBus.defenseBonus)} final-third defence and more blocked shots.`,
  },
  offside_trap: {
    id: 'offside_trap', name: 'Offside Trap', icon: '🚩', timing: 'defense', rarity: 'rare',
    description: `${pct(T.offsideTrap.successChance)} to catch them offside (+${pct(T.offsideTrap.vsLongBallBonus)} vs Long Ball). If it fails, they get a 1-on-1.`,
  },
  tactical_foul: {
    id: 'tactical_foul', name: 'Tactical Foul', icon: '🦵', timing: 'defense', rarity: 'common',
    description: 'Stop the attack with a cynical foul. Your defender is booked. Near the box it gives away a free kick.',
  },
  keeper_heroics: {
    id: 'keeper_heroics', name: 'Keeper Heroics', icon: '🧤', timing: 'defense', rarity: 'common',
    description: `Your goalkeeper is inspired: +${pct(T.keeperHeroics.keeperBonus)} on saves.`,
  },
  man_marking: {
    id: 'man_marking', name: 'Man Marking', icon: '🔒', timing: 'defense', rarity: 'rare',
    description: `Shadow their best attacker: −${pct(T.manMarking.markPenalty)} to all of their stats.`,
  },
  second_wind: {
    id: 'second_wind', name: 'Second Wind', icon: '💧', timing: 'any', rarity: 'common',
    description: `Water break: every player on the pitch recovers ${T.secondWind.energy} energy.`,
  },
  team_talk: {
    id: 'team_talk', name: 'Team Talk', icon: '📣', timing: 'any', rarity: 'rare',
    description: `Fire them up: +${pct(T.teamTalk.bonus)} to all team ratings for ${T.teamTalk.turns} turns.`,
  },
  mind_games: {
    id: 'mind_games', name: 'Mind Games', icon: '🃏', timing: 'any', rarity: 'rare',
    description: "Read your opponent: cancels the card they play this turn. Wasted if they don't play one.",
  },
};

export const CARD_IDS = Object.keys(CARD_DEFINITIONS) as CardId[];

export const RARITY_WEIGHTS: Record<CardRarity, number> = { common: 10, rare: 4, epic: 1.5 };

export function getCard(id: CardId): CardDefinition {
  return CARD_DEFINITIONS[id];
}

export function isCardPlayable(cardId: CardId, isAttacking: boolean): boolean {
  const { timing } = CARD_DEFINITIONS[cardId];
  return timing === 'any' || (timing === 'attack') === isAttacking;
}
