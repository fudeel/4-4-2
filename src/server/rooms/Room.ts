import { SIDES, type Side } from '../../shared/model/match';
import type { ClientMessage, OpponentKind } from '../../shared/protocol';
import type { MatchRules } from '../../shared/rules';
import { BotManager } from '../ai/BotManager';
import { GameError } from '../core/GameError';
import type { Rng } from '../core/Random';
import type { Scheduler } from '../core/Scheduler';
import type { GameDatabase } from '../data/repositories';
import { Match, type TeamSetup } from '../match/Match';
import { MatchRecorder } from '../match/MatchRecorder';
import type { ClientSession } from '../net/ClientSession';

export interface RoomDependencies {
  db: GameDatabase;
  rules: MatchRules;
  scheduler: Scheduler;
  createRng: () => Rng;
}

interface Seat {
  clientId: string;
  name: string;
  session: ClientSession | null;
  disconnectedAt: number | null;
}

/** A match room: two seats (home/away), the current match, and an optional bot. */
export class Room {
  private readonly seats: Partial<Record<Side, Seat>> = {};
  private readonly recorder: MatchRecorder;
  private match!: Match;
  private bot: BotManager | null = null;
  private broadcastQueued = false;
  readonly createdAt: number;

  constructor(
    readonly code: string,
    private readonly opponent: OpponentKind,
    private readonly teams: Record<Side, TeamSetup>,
    private readonly deps: RoomDependencies,
  ) {
    this.recorder = new MatchRecorder(deps.db.matches);
    this.createdAt = deps.scheduler.now();
    this.startMatch();
  }

  /** Seats a client (or re-attaches a returning one). Returns their side. */
  join(session: ClientSession): Side {
    const existing = this.sideOf(session.clientId);
    const side = existing ?? SIDES.find(s => !this.seats[s]);
    if (!side) throw new GameError('room_full', 'This room is already full.');

    const name = this.uniqueName(session.name, side);
    this.seats[side] = { clientId: session.clientId, name, session, disconnectedAt: null };
    this.match.assignManager(side, { clientId: session.clientId, name, isBot: false, connected: true });
    return side;
  }

  leave(clientId: string): void {
    const side = this.sideOf(clientId);
    if (!side) return;
    const seat = this.seats[side]!;
    seat.session = null;
    seat.disconnectedAt = this.deps.scheduler.now();
    // Before kick-off a seat can simply be given up; afterwards it is kept for reconnection.
    if (this.match.phase === 'lobby') {
      delete this.seats[side];
      this.match.releaseSeat(side);
    } else {
      this.match.setConnected(side, false);
    }
  }

  /** A socket closed. Ignored if the client has already reconnected on a newer socket. */
  disconnected(session: ClientSession): void {
    const side = this.sideOf(session.clientId);
    if (!side) return;
    const seat = this.seats[side]!;
    if (seat.session !== session) return;
    seat.session = null;
    seat.disconnectedAt = this.deps.scheduler.now();
    this.match.setConnected(side, false);
  }

  handle(clientId: string, message: ClientMessage): void {
    const side = this.sideOf(clientId);
    if (!side) throw new GameError('not_in_room', 'You are not part of this room.');
    switch (message.type) {
      case 'setLineup':
        return this.match.submitLineup(side, message.lineup);
      case 'setReady':
        return this.match.setReady(side, message.ready);
      case 'playCard':
        return this.match.playCard(side, message.cardInstanceId);
      case 'requestRematch':
        if (this.match.requestRematch(side)) this.startMatch();
        return;
      default:
        throw new GameError('bad_request', `Unsupported message: ${message.type}`);
    }
  }

  /** True when no human has been connected for `idleMs`. */
  isAbandoned(now: number, idleMs: number): boolean {
    const humans = SIDES.map(s => this.seats[s]).filter((s): s is Seat => !!s && s.clientId !== 'bot');
    if (humans.length === 0) return now - this.createdAt > idleMs;
    return humans.every(s => s.session === null && s.disconnectedAt !== null && now - s.disconnectedAt > idleMs);
  }

  dispose(): void {
    this.bot?.dispose();
    this.match.dispose();
  }

  private startMatch(): void {
    this.bot?.dispose();
    this.match?.dispose();
    this.match = new Match(
      { roomCode: this.code, home: this.teams.home, away: this.teams.away },
      { rules: this.deps.rules, rng: this.deps.createRng(), scheduler: this.deps.scheduler },
    );
    this.match.onChange(() => this.queueBroadcast());
    this.match.onFinished(summary => this.recorder.record(summary));

    for (const side of SIDES) {
      const seat = this.seats[side];
      if (seat && seat.clientId !== 'bot') {
        this.match.assignManager(side, { clientId: seat.clientId, name: seat.name, isBot: false, connected: seat.session !== null });
      }
    }

    if (this.opponent === 'bot') {
      // The room creator always takes the home seat; the bot plays away.
      const botSide: Side = 'away';
      this.seats[botSide] = { clientId: 'bot', name: 'Coach Bot', session: null, disconnectedAt: null };
      this.bot = new BotManager(this.match, botSide, this.deps.scheduler, this.deps.createRng());
      this.match.assignManager(botSide, { clientId: 'bot', name: 'Coach Bot', isBot: true, connected: true });
    }
    this.queueBroadcast();
  }

  /** Two managers with the same name (e.g. two tabs of one browser) get told apart. */
  private uniqueName(name: string, side: Side): string {
    const other = SIDES.map(s => (s === side ? undefined : this.seats[s])).find(Boolean);
    return other && other.name === name ? `${name} (2)` : name;
  }

  private sideOf(clientId: string): Side | null {
    return SIDES.find(side => this.seats[side]?.clientId === clientId) ?? null;
  }

  /** Coalesces several state changes in the same tick into one message per client. */
  private queueBroadcast(): void {
    if (this.broadcastQueued) return;
    this.broadcastQueued = true;
    queueMicrotask(() => {
      this.broadcastQueued = false;
      for (const side of SIDES) {
        const session = this.seats[side]?.session;
        if (session) session.send({ type: 'state', view: this.match.view(side) });
      }
    });
  }
}
