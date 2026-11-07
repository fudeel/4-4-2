import { SIDES } from '../../shared/model/match';
import { uniqueId } from '../core/ids';
import type { MatchRepository } from '../data/repositories';
import type { MatchRecord, PlayerMatchLine } from '../data/schema';
import type { MatchSummary } from './Match';

/** Persists finished matches and the career stats of everyone who played. */
export class MatchRecorder {
  constructor(private readonly matches: MatchRepository) {}

  record({ state, result }: MatchSummary): void {
    const side = (s: 'home' | 'away') => ({
      teamId: state.team(s).profile.id,
      manager: state.team(s).manager?.name ?? 'Unknown',
      score: state.score[s],
    });
    const record: MatchRecord = {
      id: uniqueId('match'),
      playedAt: new Date().toISOString(),
      home: side('home'),
      away: side('away'),
      scorers: result.scorers,
      manOfTheMatch: result.manOfTheMatch?.playerId ?? null,
    };

    const lines: PlayerMatchLine[] = SIDES.flatMap(s =>
      [...state.team(s).players.values()]
        .filter(p => p.appeared)
        .map(p => ({
          playerId: p.id,
          goals: p.goals,
          assists: p.assists,
          yellowCards: p.yellowCards,
          redCard: p.sentOff,
          rating: p.rating,
        })),
    );

    try {
      this.matches.save(record, lines);
    } catch (error) {
      console.error('[db] Failed to save match result', error);
    }
  }
}
