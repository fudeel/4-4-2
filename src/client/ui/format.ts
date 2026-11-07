import type { CardTiming } from '../../shared/model/cards';
import type { MatchView, Side, TeamView } from '../../shared/model/match';
import { overallRating, surname, type PlayerProfile, type Position } from '../../shared/model/player';

export const TIMING_LABEL: Record<CardTiming, string> = { attack: 'ATTACK', defense: 'DEFENSE', any: 'ANY TIME' };

export function playerById(view: MatchView, playerId: string | undefined): { player: PlayerProfile; side: Side } | null {
  if (!playerId) return null;
  for (const side of ['home', 'away'] as const) {
    const player = view.teams[side].squad.find(p => p.id === playerId);
    if (player) return { player, side };
  }
  return null;
}

export function shortName(player: PlayerProfile): string {
  return surname(player.name);
}

export function energyColor(energy: number): string {
  if (energy >= 70) return 'var(--good)';
  if (energy >= 45) return 'var(--warn)';
  return 'var(--bad)';
}

export function ratingClass(rating: number): string {
  if (rating >= 7.5) return 'rating rating--great';
  if (rating >= 6.5) return 'rating rating--good';
  if (rating >= 5.5) return 'rating';
  return 'rating rating--poor';
}

export function ovr(player: PlayerProfile, role: Position = player.position): number {
  return overallRating(player, role);
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function teamLabel(team: TeamView): string {
  return team.team.shortName;
}

/** Remaining whole seconds of the current phase on the server clock. */
export function secondsLeft(view: MatchView, serverNow: number): number | null {
  if (view.phaseEndsAt === null) return null;
  return Math.max(0, Math.ceil((view.phaseEndsAt - serverNow) / 1000));
}
