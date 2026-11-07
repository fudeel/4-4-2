import type { MatchResultView, MatchView, Side, TeamView } from '../../../shared/model/match';
import type { TeamState } from '../model/TeamState';
import type { MatchState } from './MatchState';

/**
 * Builds what one manager is allowed to see. The opponent's hand and selected card
 * are hidden: only the number of cards and whether they've locked in are exposed.
 */
export class MatchViewBuilder {
  build(state: MatchState, you: Side, now: number): MatchView {
    const mine = state.team(you);
    return {
      roomCode: state.roomCode,
      you,
      phase: state.phase,
      phaseEndsAt: state.phaseEndsAt,
      serverNow: now,
      turn: state.turn,
      turnsPerHalf: state.turnsPerHalf,
      totalTurns: state.totalTurns,
      half: state.half,
      minute: state.minute,
      attackingSide: state.attackingSide,
      counterAttack: state.counterAttack,
      score: { ...state.score },
      momentum: state.momentum.raw,
      teams: { home: this.team(state.team('home')), away: this.team(state.team('away')) },
      hand: [...mine.hand.list()],
      selection: { ...mine.selection },
      activeEffects: state.effects.toView(),
      lastAction: state.lastAction,
      commentary: [...state.commentary.all()],
      rematch: { ...state.rematch },
      result: state.phase === 'fulltime' ? this.result(state) : null,
      rules: {
        planningSeconds: state.rules.planningSeconds,
        halfTimeSeconds: state.rules.halfTimeSeconds,
        maxSubstitutions: state.rules.maxSubstitutions,
        handLimit: state.rules.handLimit,
        minutesPerTurn: state.rules.minutesPerTurn,
        resolutionBufferMs: state.rules.resolutionBufferMs,
      },
    };
  }

  result(state: MatchState): MatchResultView {
    const { home, away } = state.score;
    const winner: Side | null = home === away ? null : home > away ? 'home' : 'away';
    let manOfTheMatch: MatchResultView['manOfTheMatch'] = null;
    for (const side of ['home', 'away'] as const) {
      for (const player of state.team(side).players.values()) {
        if (!player.appeared) continue;
        // Small bonus for the winning side, as tradition demands.
        const score = player.rating + (side === winner ? 0.2 : 0);
        if (!manOfTheMatch || score > manOfTheMatch.rating) {
          manOfTheMatch = { playerId: player.id, side, rating: score };
        }
      }
    }
    if (manOfTheMatch) {
      const player = state.team(manOfTheMatch.side).player(manOfTheMatch.playerId);
      manOfTheMatch.rating = Math.round(player.rating * 10) / 10;
    }
    return { winner, manOfTheMatch, scorers: [...state.goals] };
  }

  private team(team: TeamState): TeamView {
    const players: TeamView['players'] = {};
    for (const [id, player] of team.players) players[id] = player.toState();
    return {
      side: team.side,
      team: team.profile,
      squad: [...team.squad],
      players,
      lineup: { formationId: team.lineup.formationId, slots: [...team.lineup.slots] },
      manager: team.managerView(),
      ready: team.ready,
      locked: team.selection.locked,
      mentality: team.mentality,
      handCount: team.hand.size,
      subsUsed: team.subsUsed + team.pendingSubstitutions(),
      stats: { ...team.stats, xg: Math.round(team.stats.xg * 100) / 100 },
    };
  }
}
