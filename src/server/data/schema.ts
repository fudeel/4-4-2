import type { Side } from '../../shared/model/match';
import type { PlayerProfile } from '../../shared/model/player';
import type { TeamProfile } from '../../shared/model/team';

export interface PlayerCareerStats {
  playerId: string;
  appearances: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  ratingSum: number;
}

export interface MatchRecordSide {
  teamId: string;
  manager: string;
  score: number;
}

export interface MatchRecord {
  id: string;
  playedAt: string;
  home: MatchRecordSide;
  away: MatchRecordSide;
  scorers: { playerId: string; side: Side; minute: number }[];
  manOfTheMatch: string | null;
}

/** Per-player line of a finished match, used to update career stats. */
export interface PlayerMatchLine {
  playerId: string;
  goals: number;
  assists: number;
  yellowCards: number;
  redCard: boolean;
  rating: number;
}

export interface DatabaseSchema {
  version: 1;
  teams: TeamProfile[];
  players: PlayerProfile[];
  playerStats: Record<string, PlayerCareerStats>;
  matches: MatchRecord[];
}
