import { isCardPlayable } from '../../shared/model/cards';
import { LineupBuilder, type Lineup } from '../../shared/model/lineup';
import { SIDES, type MatchPhase, type MatchResultView, type MatchView, type Side } from '../../shared/model/match';
import type { PlayerProfile } from '../../shared/model/player';
import type { TeamProfile } from '../../shared/model/team';
import type { MatchRules } from '../../shared/rules';
import { GameError } from '../core/GameError';
import type { Rng } from '../core/Random';
import type { Scheduler, TimerHandle } from '../core/Scheduler';
import { CardDealer } from './cards/CardHand';
import { FatigueModel } from './flow/MatchDynamics';
import { MatchState } from './flow/MatchState';
import { MatchViewBuilder } from './flow/MatchViewBuilder';
import { TurnResolver } from './flow/TurnResolver';
import { TeamState, type Manager } from './model/TeamState';

export interface TeamSetup {
  team: TeamProfile;
  squad: PlayerProfile[];
}

export interface MatchSetup {
  roomCode: string;
  home: TeamSetup;
  away: TeamSetup;
}

export interface MatchDependencies {
  rules: MatchRules;
  rng: Rng;
  scheduler: Scheduler;
  turnResolver?: TurnResolver;
}

export interface MatchSummary {
  state: MatchState;
  result: MatchResultView;
}

const DEFAULT_FORMATION = '2-2-1';

/**
 * The match state machine:
 * lobby → (planning → resolving) × turns → halftime → (planning → resolving) × turns → fulltime.
 * Every command validates the phase and throws a `GameError` on rule violations.
 */
export class Match {
  readonly state: MatchState;
  private readonly turnResolver: TurnResolver;
  private readonly views = new MatchViewBuilder();
  private readonly fatigue = new FatigueModel();
  private readonly changeListeners = new Set<() => void>();
  private readonly finishListeners = new Set<(summary: MatchSummary) => void>();
  private timer: TimerHandle | null = null;
  private disposed = false;

  constructor(
    setup: MatchSetup,
    private readonly deps: MatchDependencies,
  ) {
    const createTeam = (side: Side, { team, squad }: TeamSetup) =>
      new TeamState(side, team, squad, new CardDealer(deps.rng, side), deps.rules, LineupBuilder.best(DEFAULT_FORMATION, squad));
    this.state = new MatchState(setup.roomCode, deps.rules, {
      home: createTeam('home', setup.home),
      away: createTeam('away', setup.away),
    });
    this.turnResolver = deps.turnResolver ?? new TurnResolver(deps.rng);
  }

  get phase(): MatchPhase {
    return this.state.phase;
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onFinished(listener: (summary: MatchSummary) => void): () => void {
    this.finishListeners.add(listener);
    return () => this.finishListeners.delete(listener);
  }

  view(side: Side): MatchView {
    return this.views.build(this.state, side, this.deps.scheduler.now());
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  assignManager(side: Side, manager: Manager): void {
    this.state.team(side).manager = manager;
    this.emitChange();
  }

  setConnected(side: Side, connected: boolean): void {
    const team = this.state.team(side);
    if (!team.manager) return;
    team.manager.connected = connected;
    if (!connected && this.phase === 'planning' && !team.selection.locked) {
      team.selection = { locked: true, cardInstanceId: null };
      if (this.bothLocked()) return this.resolveTurn();
    }
    this.emitChange();
  }

  submitLineup(side: Side, lineup: Lineup): void {
    const team = this.state.team(side);
    if (this.phase !== 'lobby' && this.phase !== 'halftime') {
      throw new GameError('invalid_phase', 'Lineup changes are only allowed before kick-off and at half-time.');
    }
    if (team.ready) throw new GameError('invalid_phase', 'You are marked as ready. Unready to make changes.');
    team.applyLineup(lineup);
    this.emitChange();
  }

  setReady(side: Side, ready: boolean): void {
    if (this.phase !== 'lobby' && this.phase !== 'halftime') {
      throw new GameError('invalid_phase', 'Nothing to get ready for right now.');
    }
    this.state.team(side).ready = ready;
    const bothReady = SIDES.every(s => this.state.team(s).ready && this.state.team(s).manager);
    if (bothReady) {
      return this.phase === 'lobby' ? this.kickOff() : this.startSecondHalf();
    }
    this.emitChange();
  }

  /** Moves the Defence ↔ Attack slider. Allowed at any point of the match; it applies from the next action. */
  setMentality(side: Side, value: number): void {
    if (this.phase === 'fulltime') throw new GameError('invalid_phase', 'The match is over.');
    const team = this.state.team(side);
    const before = team.mentality;
    team.setMentality(value);
    if (team.mentality !== before) this.emitChange();
  }

  /** Plays a card from hand, or skips the turn when `cardInstanceId` is null. */
  playCard(side: Side, cardInstanceId: string | null): void {
    if (this.phase !== 'planning') throw new GameError('invalid_phase', 'You can only play cards while a turn is being planned.');
    const team = this.state.team(side);
    if (team.selection.locked) throw new GameError('already_locked', 'You already made your move this turn.');
    if (cardInstanceId !== null) {
      const card = team.hand.find(cardInstanceId);
      if (!card) throw new GameError('invalid_card', 'That card is not in your hand.');
      if (!isCardPlayable(card.cardId, this.state.attackingSide === side)) {
        throw new GameError('invalid_card', this.state.attackingSide === side ? 'That is a defensive card.' : 'That card can only be played in attack.');
      }
    }
    team.selection = { locked: true, cardInstanceId };
    if (this.bothLocked()) return this.resolveTurn();
    this.emitChange();
  }

  /** Frees a seat before kick-off (the manager left the lobby). */
  releaseSeat(side: Side): void {
    if (this.phase !== 'lobby') throw new GameError('invalid_phase', 'Seats can only be released before kick-off.');
    const team = this.state.team(side);
    team.manager = null;
    team.ready = false;
    this.emitChange();
  }

  /** Returns true when both managers want a rematch. Bots always do. */
  requestRematch(side: Side): boolean {
    if (this.phase !== 'fulltime') throw new GameError('invalid_phase', 'The match is not over yet.');
    this.state.rematch[side] = true;
    this.emitChange();
    return SIDES.every(s => {
      const manager = this.state.team(s).manager;
      return this.state.rematch[s] || !manager || manager.isBot;
    });
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.changeListeners.clear();
    this.finishListeners.clear();
  }

  // ── Flow ──────────────────────────────────────────────────────────────────

  private kickOff(): void {
    for (const side of SIDES) {
      const team = this.state.team(side);
      team.markStartersAppeared();
      team.hand.refill(team.dealer);
      team.ready = false;
    }
    const { home, away } = this.state.teams;
    this.state.commentary.info(0, `Kick-off! ${home.profile.name} vs ${away.profile.name}.`);
    this.beginTurn();
  }

  private beginTurn(): void {
    const state = this.state;
    state.turn += 1;
    const isHalfKickoff = state.turnInHalf === 1;
    if (!isHalfKickoff && (state.turnInHalf - 1) % state.rules.drawEveryTurns === 0) {
      for (const side of SIDES) {
        const team = state.team(side);
        if (!team.hand.isFull) team.hand.add(team.dealer.deal(team.hand.list().map(c => c.cardId)));
      }
    }

    state.attackingSide = state.possession.decide(isHalfKickoff, state.half, state.effects.forcedAttacker());
    if (state.counterAttack !== state.attackingSide) state.counterAttack = null;

    for (const side of SIDES) {
      const team = state.team(side);
      team.resetSelection();
      // Absent managers skip automatically so the match never stalls.
      if (!team.manager || !team.manager.connected) team.selection = { locked: true, cardInstanceId: null };
    }

    this.setPhase('planning', state.rules.planningSeconds * 1000, () => this.resolveTurn());
    if (this.bothLocked()) return this.resolveTurn();
    this.emitChange();
  }

  private resolveTurn(): void {
    if (this.disposed) return;
    for (const side of SIDES) {
      const team = this.state.team(side);
      if (!team.selection.locked) team.selection = { locked: true, cardInstanceId: null };
    }
    const report = this.turnResolver.resolve(this.state);
    this.state.lastAction = report;
    this.setPhase('resolving', report.durationMs + this.state.rules.resolutionBufferMs, () => this.afterAction());
    this.emitChange();
  }

  private afterAction(): void {
    const state = this.state;
    if (state.turn >= state.totalTurns) return this.finish();
    if (state.turn === state.turnsPerHalf) return this.startHalfTime();
    this.beginTurn();
  }

  private startHalfTime(): void {
    const state = this.state;
    state.effects.clear();
    state.counterAttack = null;
    state.attackingSide = null;
    for (const side of SIDES) {
      const team = state.team(side);
      this.fatigue.recoverAtHalfTime(team);
      team.beginHalfTime();
      team.hand.refill(team.dealer);
      team.ready = !team.manager || !team.manager.connected;
      team.resetSelection();
    }
    const { home, away } = state.score;
    state.commentary.info(state.rules.halfLengthMinutes, `Half-time: ${state.team('home').profile.shortName} ${home}–${away} ${state.team('away').profile.shortName}.`);
    this.setPhase('halftime', state.rules.halfTimeSeconds * 1000, () => this.startSecondHalf());
    this.emitChange();
  }

  private startSecondHalf(): void {
    for (const side of SIDES) {
      const team = this.state.team(side);
      team.commitHalfTime();
      team.ready = false;
    }
    this.state.commentary.info(this.state.rules.halfLengthMinutes, 'The second half is under way!');
    this.beginTurn();
  }

  private finish(): void {
    const state = this.state;
    state.attackingSide = null;
    this.setPhase('fulltime', null);
    const { home, away } = state.score;
    state.commentary.info(state.rules.halfLengthMinutes * 2, `Full-time: ${state.team('home').profile.shortName} ${home}–${away} ${state.team('away').profile.shortName}.`);
    const result = this.views.result(state);
    this.emitChange();
    for (const listener of this.finishListeners) listener({ state, result });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private bothLocked(): boolean {
    return SIDES.every(s => this.state.team(s).selection.locked);
  }

  private setPhase(phase: MatchPhase, durationMs: number | null, onTimeout?: () => void): void {
    this.cancelTimer();
    this.state.phase = phase;
    this.state.phaseEndsAt = durationMs === null ? null : this.deps.scheduler.now() + durationMs;
    if (durationMs !== null && onTimeout) {
      this.timer = this.deps.scheduler.schedule(durationMs, () => {
        this.timer = null;
        if (!this.disposed) onTimeout();
      });
    }
  }

  private cancelTimer(): void {
    this.timer?.cancel();
    this.timer = null;
  }

  private emitChange(): void {
    if (this.disposed) return;
    for (const listener of this.changeListeners) listener();
  }
}
