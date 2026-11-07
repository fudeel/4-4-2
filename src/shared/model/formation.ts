import type { Position } from './player';

export type FormationId = '2-2-1' | '3-1-1' | '2-1-2' | '1-3-1' | '1-2-2';

/**
 * A slot on the pitch, in normalised team space:
 * x = -1 (left touchline) … 1 (right touchline), seen from the team's own goal;
 * y = 0 (own goal line) … 1 (opponent goal line).
 */
export interface FormationSlot {
  role: Position;
  x: number;
  y: number;
}

export interface Formation {
  id: FormationId;
  style: string;
  description: string;
  /** Slot 0 is always the goalkeeper. */
  slots: FormationSlot[];
}

const GK: FormationSlot = { role: 'GK', x: 0, y: 0.04 };

export const FORMATIONS: Record<FormationId, Formation> = {
  '2-2-1': {
    id: '2-2-1',
    style: 'Balanced',
    description: 'Solid in every zone. A safe default.',
    slots: [
      GK,
      { role: 'DEF', x: -0.45, y: 0.22 },
      { role: 'DEF', x: 0.45, y: 0.22 },
      { role: 'MID', x: -0.4, y: 0.45 },
      { role: 'MID', x: 0.4, y: 0.45 },
      { role: 'FWD', x: 0, y: 0.68 },
    ],
  },
  '3-1-1': {
    id: '3-1-1',
    style: 'Defensive',
    description: 'Three at the back. Hard to break down, slow to build.',
    slots: [
      GK,
      { role: 'DEF', x: -0.6, y: 0.23 },
      { role: 'DEF', x: 0, y: 0.2 },
      { role: 'DEF', x: 0.6, y: 0.23 },
      { role: 'MID', x: 0, y: 0.45 },
      { role: 'FWD', x: 0, y: 0.68 },
    ],
  },
  '2-1-2': {
    id: '2-1-2',
    style: 'Attacking',
    description: 'Two strikers up top. Dangerous, but the midfield can be overrun.',
    slots: [
      GK,
      { role: 'DEF', x: -0.45, y: 0.22 },
      { role: 'DEF', x: 0.45, y: 0.22 },
      { role: 'MID', x: 0, y: 0.43 },
      { role: 'FWD', x: -0.35, y: 0.67 },
      { role: 'FWD', x: 0.35, y: 0.67 },
    ],
  },
  '1-3-1': {
    id: '1-3-1',
    style: 'Possession',
    description: 'Midfield control. Wins the build-up, exposed at the back.',
    slots: [
      GK,
      { role: 'DEF', x: 0, y: 0.22 },
      { role: 'MID', x: -0.6, y: 0.45 },
      { role: 'MID', x: 0, y: 0.42 },
      { role: 'MID', x: 0.6, y: 0.45 },
      { role: 'FWD', x: 0, y: 0.68 },
    ],
  },
  '1-2-2': {
    id: '1-2-2',
    style: 'All-out attack',
    description: 'Maximum firepower. Pray your keeper is in form.',
    slots: [
      GK,
      { role: 'DEF', x: 0, y: 0.22 },
      { role: 'MID', x: -0.4, y: 0.44 },
      { role: 'MID', x: 0.4, y: 0.44 },
      { role: 'FWD', x: -0.35, y: 0.67 },
      { role: 'FWD', x: 0.35, y: 0.67 },
    ],
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

export function getFormation(id: FormationId): Formation {
  const formation = FORMATIONS[id];
  if (!formation) throw new Error(`Unknown formation: ${id}`);
  return formation;
}

export function isFormationId(value: unknown): value is FormationId {
  return typeof value === 'string' && value in FORMATIONS;
}
