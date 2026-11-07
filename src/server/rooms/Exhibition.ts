import { overallRating } from '../../shared/model/player';
import type { ExhibitionOptions } from '../../shared/model/exhibition';
import type { MatchRules } from '../../shared/rules';
import type { TeamSetup } from '../match/Match';

export function exhibitionRules(base: MatchRules, options: ExhibitionOptions): MatchRules {
  return options.pace === 'quick' ? { ...base, halfLengthMinutes: 15, planningSeconds: 12, halfTimeSeconds: 15, resolutionBufferMs: 600 } : { ...base };
}
export function exhibitionTeam(setup: TeamSetup, fairPlay: boolean, factor = 1): TeamSetup {
  const result = structuredClone(setup);
  const average = result.squad.reduce((n, p) => n + overallRating(p), 0) / result.squad.length;
  const scale = (fairPlay ? 60 / Math.max(1, average) : 1) * factor;
  for (const p of result.squad) for (const key of Object.keys(p.attributes) as (keyof typeof p.attributes)[]) p.attributes[key] = Math.max(1, Math.min(99, Math.round(p.attributes[key] * scale)));
  return result;
}

/** Give the away side a readable alternate kit when two custom colours clash. */
export function contrastKits(home: TeamSetup, away: TeamSetup): void {
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const a = rgb(home.team.primaryColor), b = rgb(away.team.primaryColor);
  if (Math.hypot(...a.map((c, i) => c - b[i]!)) < 100) {
    const light = (a[0]! * 0.2126 + a[1]! * 0.7152 + a[2]! * 0.0722) / 255;
    away.team.primaryColor = light > 0.6 ? '#23304c' : '#f0f3e8';
    away.team.secondaryColor = light > 0.6 ? '#f0f3e8' : '#23304c';
  }
}
