import type { PlayerProfile } from '../../shared/model/player';
import type { TeamProfile } from '../../shared/model/team';
import type { MatchRecord, PlayerCareerStats, PlayerMatchLine } from './schema';

/*
 * Persistence ports. The game depends only on these interfaces, so the local JSON
 * database can later be replaced (Postgres, Firestore, …) without touching game code.
 */

export interface TeamRepository {
  findAll(): TeamProfile[];
  findById(id: string): TeamProfile | undefined;
}

export interface PlayerRepository {
  findByTeam(teamId: string): PlayerProfile[];
  findById(id: string): PlayerProfile | undefined;
  careerStats(playerId: string): PlayerCareerStats | undefined;
}

export interface MatchRepository {
  save(record: MatchRecord, lines: PlayerMatchLine[]): void;
  recent(limit: number): MatchRecord[];
}

export interface GameDatabase {
  teams: TeamRepository;
  players: PlayerRepository;
  matches: MatchRepository;
}
