export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';

export const POSITIONS: readonly Position[] = ['GK', 'DEF', 'MID', 'FWD'];

/** All attributes are on a 1–99 scale. */
export interface PlayerAttributes {
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
  goalkeeping: number;
  /** How slowly the player tires during a match. */
  stamina: number;
}

export type AttributeKey = keyof PlayerAttributes;

export const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  pace: 'PAC',
  shooting: 'SHO',
  passing: 'PAS',
  dribbling: 'DRI',
  defending: 'DEF',
  physical: 'PHY',
  goalkeeping: 'GK',
  stamina: 'STA',
};

export type TraitId =
  | 'clinical'
  | 'playmaker'
  | 'wall'
  | 'speedster'
  | 'reflexes'
  | 'engine'
  | 'hothead'
  | 'aerial'
  | 'leader';

export interface TraitDefinition {
  id: TraitId;
  name: string;
  icon: string;
  description: string;
}

export const TRAITS: Record<TraitId, TraitDefinition> = {
  clinical: { id: 'clinical', name: 'Clinical', icon: '🎯', description: '+10% when shooting.' },
  playmaker: { id: 'playmaker', name: 'Playmaker', icon: '🧠', description: '+10% when building play or creating chances.' },
  wall: { id: 'wall', name: 'The Wall', icon: '🧱', description: '+10% when defending the final third.' },
  speedster: { id: 'speedster', name: 'Speedster', icon: '⚡', description: '+10% when running at defenders.' },
  reflexes: { id: 'reflexes', name: 'Cat Reflexes', icon: '🐈', description: 'Goalkeeper +10% on saves.' },
  engine: { id: 'engine', name: 'Engine', icon: '🔋', description: 'Tires 40% slower.' },
  hothead: { id: 'hothead', name: 'Hothead', icon: '🔥', description: '+10% when pressing, but books more often.' },
  aerial: { id: 'aerial', name: 'Aerial Threat', icon: '🦅', description: '+20% in aerial duels and headers.' },
  leader: { id: 'leader', name: 'Leader', icon: '©️', description: 'Teammates lose 15% less momentum after setbacks.' },
};

export interface PlayerProfile {
  id: string;
  teamId: string;
  name: string;
  number: number;
  position: Position;
  /** Three-letter nationality code (display only). */
  nationality: string;
  age: number;
  attributes: PlayerAttributes;
  trait: TraitId | null;
}

type AttributeWeights = Partial<Record<AttributeKey, number>>;

const OVERALL_WEIGHTS: Record<Position, AttributeWeights> = {
  GK: { goalkeeping: 0.8, physical: 0.1, passing: 0.1 },
  DEF: { defending: 0.45, physical: 0.25, pace: 0.15, passing: 0.15 },
  MID: { passing: 0.35, dribbling: 0.25, defending: 0.15, pace: 0.1, shooting: 0.1, physical: 0.05 },
  FWD: { shooting: 0.4, dribbling: 0.25, pace: 0.2, physical: 0.1, passing: 0.05 },
};

export function weightedAttributes(attributes: PlayerAttributes, weights: AttributeWeights): number {
  let total = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(weights) as [AttributeKey, number][]) {
    total += attributes[key] * weight;
    weightSum += weight;
  }
  return weightSum === 0 ? 0 : total / weightSum;
}

/** How well a player performs when used in a slot that is not their natural position. */
export function positionFit(natural: Position, slot: Position): number {
  if (natural === slot) return 1;
  if (slot === 'GK') return 1; // an outfielder's (low) goalkeeping stat already punishes this
  if (natural === 'GK') return 0.7;
  const order: Position[] = ['DEF', 'MID', 'FWD'];
  const distance = Math.abs(order.indexOf(natural) - order.indexOf(slot));
  return distance === 1 ? 0.9 : 0.8;
}

/** Overall rating (1–99) of a player when playing in the given role. */
export function overallRating(player: Pick<PlayerProfile, 'position' | 'attributes'>, role: Position = player.position): number {
  const base = weightedAttributes(player.attributes, OVERALL_WEIGHTS[role]);
  return Math.round(base * positionFit(player.position, role));
}

export function surname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : fullName;
}
