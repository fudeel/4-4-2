import type { PlayerProfile } from '../../shared/model/player';
import type { TeamProfile } from '../../shared/model/team';
import { JsonFileStore } from './JsonFileStore';
import type { GameDatabase, MatchRepository, PlayerRepository, TeamRepository } from './repositories';
import type { DatabaseSchema, MatchRecord, PlayerCareerStats, PlayerMatchLine } from './schema';
import { SEED_PLAYERS, SEED_TEAMS } from './seed';

const MAX_STORED_MATCHES = 500;

function createSeededSchema(): DatabaseSchema {
  return {
    version: 1,
    teams: structuredClone(SEED_TEAMS),
    players: structuredClone(SEED_PLAYERS),
    playerStats: {},
    matches: [],
  };
}

class JsonTeamRepository implements TeamRepository {
  constructor(private readonly store: JsonFileStore<DatabaseSchema>) {}

  findAll(): TeamProfile[] {
    return this.store.read().teams;
  }

  findById(id: string): TeamProfile | undefined {
    return this.store.read().teams.find(t => t.id === id);
  }
}

class JsonPlayerRepository implements PlayerRepository {
  constructor(private readonly store: JsonFileStore<DatabaseSchema>) {}

  findByTeam(teamId: string): PlayerProfile[] {
    return this.store.read().players.filter(p => p.teamId === teamId);
  }

  findById(id: string): PlayerProfile | undefined {
    return this.store.read().players.find(p => p.id === id);
  }

  careerStats(playerId: string): PlayerCareerStats | undefined {
    return this.store.read().playerStats[playerId];
  }
}

class JsonMatchRepository implements MatchRepository {
  constructor(private readonly store: JsonFileStore<DatabaseSchema>) {}

  save(record: MatchRecord, lines: PlayerMatchLine[]): void {
    this.store.update(db => {
      db.matches.push(record);
      if (db.matches.length > MAX_STORED_MATCHES) db.matches.splice(0, db.matches.length - MAX_STORED_MATCHES);
      for (const line of lines) {
        const stats = (db.playerStats[line.playerId] ??= {
          playerId: line.playerId, appearances: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, ratingSum: 0,
        });
        stats.appearances += 1;
        stats.goals += line.goals;
        stats.assists += line.assists;
        stats.yellowCards += line.yellowCards;
        stats.redCards += line.redCard ? 1 : 0;
        stats.ratingSum += line.rating;
      }
    });
  }

  recent(limit: number): MatchRecord[] {
    return this.store.read().matches.slice(-limit).reverse();
  }
}

export function createJsonDatabase(filePath: string): GameDatabase {
  const store = new JsonFileStore<DatabaseSchema>(filePath, createSeededSchema);
  return {
    teams: new JsonTeamRepository(store),
    players: new JsonPlayerRepository(store),
    matches: new JsonMatchRepository(store),
  };
}
