import type { Lineup } from '../../shared/model/lineup';
import type { MatchView } from '../../shared/model/match';
import type { OpponentKind } from '../../shared/protocol';
import type { ConnectionStatus } from '../net/GameConnection';
import type { AccountView } from '../../shared/model/account';
import type { ClubView } from '../../shared/model/club';
import type { ExhibitionOptions } from '../../shared/model/exhibition';

export interface ClientState {
  club: ClubView | null;
  clubReady: boolean;
  clubBusy: boolean;
  clubError: string;
  account: AccountView | null;
  authReady: boolean;
  authBusy: boolean;
  authError: string;
  connection: ConnectionStatus;
  view: MatchView | null;
  /** serverTime − Date.now(), so countdowns agree across devices. */
  clockOffset: number;
  playerName: string;
}

/** Everything the UI can ask for. Screens depend on this interface, not on the network (DIP). */
export interface GameActions {
  createClub(name: string, shortName: string, color: string): void;
  signIn(username: string, password: string, register: boolean): void;
  signOut(): void;
  createRoom(opponent: OpponentKind, options?: ExhibitionOptions): void;
  joinRoom(code: string): void;
  leaveRoom(): void;
  setLineup(lineup: Lineup): void;
  setReady(ready: boolean): void;
  playCard(cardInstanceId: string | null): void;
  setMentality(value: number): void;
  requestRematch(): void;
  shareLink(code: string): string;
}

/** A minimal observable store. */
export class GameStore {
  private state: ClientState;
  private readonly listeners = new Set<(state: ClientState) => void>();

  constructor(initial: ClientState) {
    this.state = initial;
  }

  get(): ClientState {
    return this.state;
  }

  patch(partial: Partial<ClientState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach(l => l(this.state));
  }

  subscribe(listener: (state: ClientState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Current time on the server clock. */
  serverNow(): number {
    return Date.now() + this.state.clockOffset;
  }
}
