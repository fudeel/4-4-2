/**
 * Team mentality: one slider from −100 (everyone behind the ball) to +100 (everyone forward).
 * It covers the always-on decisions — how hard to tackle, how deep to defend, how many players
 * join the attack — so cards are left for the big, one-off moments.
 */
export const MENTALITY = { min: -100, max: 100, step: 10, initial: 0 } as const;

/** Effects at the two extremes; everything in between scales linearly. */
export const MENTALITY_TUNING = {
  /** Strength gained by the side of the game you lean towards (attack or defence)… */
  gain: 0.24,
  /** …and lost by the side you neglect. The price of leaning is paid in fouls or exposure. */
  loss: 0.18,
  /** Extra fouls when fully defensive (×1.6): hard tackles give away free kicks and penalties. */
  fouls: 0.6,
  /** Extra booking chance per foul when fully defensive. */
  bookings: 0.12,
  /** Extra block chance when everyone is behind the ball. */
  blocks: 0.05,
  /** Chance-quality bonus from runners arriving in the box when fully attacking. */
  chanceQuality: 0.06,
  /** Chance that losing the ball springs a counter-attack against a fully attacking team. */
  counterExposure: 0.2,
  /** Extra energy each player loses per turn when fully attacking. */
  fatigue: 1,
} as const;

export interface MentalityEffects {
  /** Multiplier on build-up and chance-creation strength while attacking. */
  attack: number;
  /** Multiplier on pressing and final-third defence while defending. */
  defense: number;
  /** Multiplier on how often the team fouls while defending. */
  fouls: number;
  /** Added to the yellow-card chance of every foul. */
  bookings: number;
  /** Added to the chance of blocking a shot. */
  blocks: number;
  /** Added to the quality of the chances the team creates. */
  chanceQuality: number;
  /** Chance that a lost ball turns into a counter-attack against the team. */
  counterExposure: number;
  /** Extra energy drained from each player per turn. */
  fatigue: number;
}

export interface MentalityBand {
  name: string;
  icon: string;
  /** Short phrase for the commentary, e.g. "drop deeper". */
  verb: string;
}

const BANDS: { upTo: number; band: MentalityBand }[] = [
  { upTo: -70, band: { name: 'Ultra defensive', icon: '🧱', verb: 'park everyone behind the ball' } },
  { upTo: -30, band: { name: 'Defensive', icon: '🛡️', verb: 'drop deeper' } },
  { upTo: 20, band: { name: 'Balanced', icon: '⚖️', verb: 'settle into a balanced shape' } },
  { upTo: 60, band: { name: 'Attacking', icon: '⚔️', verb: 'push forward' } },
  { upTo: MENTALITY.max, band: { name: 'All-out attack', icon: '🔥', verb: 'throw everyone forward' } },
];

/** Clamps any number to the slider range and snaps it to the slider step. */
export function normalizeMentality(value: number): number {
  if (!Number.isFinite(value)) return MENTALITY.initial;
  const snapped = Math.round(value / MENTALITY.step) * MENTALITY.step;
  return Math.min(MENTALITY.max, Math.max(MENTALITY.min, snapped)) || 0;
}

export function mentalityEffects(value: number): MentalityEffects {
  const T = MENTALITY_TUNING;
  const m = normalizeMentality(value) / MENTALITY.max;
  const defensive = Math.max(0, -m);
  const attacking = Math.max(0, m);
  return {
    attack: 1 + T.gain * attacking - T.loss * defensive,
    defense: 1 + T.gain * defensive - T.loss * attacking,
    fouls: 1 + T.fouls * defensive,
    bookings: T.bookings * defensive,
    blocks: T.blocks * defensive,
    chanceQuality: T.chanceQuality * m,
    counterExposure: T.counterExposure * attacking,
    fatigue: T.fatigue * attacking,
  };
}

export function mentalityBand(value: number): MentalityBand {
  const m = normalizeMentality(value);
  return (BANDS.find(b => m <= b.upTo) ?? BANDS[BANDS.length - 1]!).band;
}

const signedPct = (multiplier: number): string => {
  const pct = Math.round((multiplier - 1) * 100);
  return `${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)}%`;
};

/** Human-readable effects, generated from the same numbers the engine uses. */
export function mentalitySummary(value: number): string[] {
  const e = mentalityEffects(value);
  const lines = [`Attack ${signedPct(e.attack)}`, `Defence ${signedPct(e.defense)}`];
  if (e.fouls > 1.001) lines.push(`Fouls ×${e.fouls.toFixed(1)}`);
  if (e.counterExposure > 0) lines.push(`Counter risk ${Math.round(e.counterExposure * 100)}%`);
  if (e.fatigue > 0) lines.push(`Tires faster`);
  return lines;
}
