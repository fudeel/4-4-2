import type { ServerMessage } from '../shared/protocol';
import type { Sfx } from './audio/Sfx';
import type { GameConnection } from './net/GameConnection';
import type { Identity } from './net/Identity';
import type { ClientState, GameActions, GameStore } from './state/GameStore';
import { Toaster } from './ui/components/Toaster';
import { h, setText } from './ui/dom';
import { HomeScreen } from './ui/screens/HomeScreen';
import { LobbyScreen } from './ui/screens/LobbyScreen';
import { MatchScreen } from './ui/screens/MatchScreen';
import type { Screen, ScreenContext } from './ui/screens/Screen';
import { AccountScreen } from './ui/screens/AccountScreen';
import { managerRequest } from './net/ManagerClient';
import type { AccountView } from '../shared/model/account';

type ScreenKind = 'account' | 'home' | 'lobby' | 'match';

/** Wires network ↔ store ↔ screens and switches screens as the match progresses. */
export class App {
  private screen: Screen | null = null;
  private screenKind: ScreenKind | null = null;
  private readonly toaster = new Toaster();
  private readonly host = h('div', { class: 'screen-host' });
  private readonly connectionBadge = h('div', { class: 'conn-badge' });
  private readonly context: ScreenContext;

  constructor(
    private readonly root: HTMLElement,
    private readonly connection: GameConnection,
    private readonly store: GameStore,
    private readonly identity: Identity,
    sfx: Sfx,
  ) {
    this.context = { actions: this.createActions(), store, sfx, toaster: this.toaster };
  }

  start(): void {
    this.root.append(this.host, this.toaster.element, this.connectionBadge);
    this.connection.onOpen(() => this.connection.send({ type: 'hello', clientId: this.identity.clientId, name: this.identity.name }));
    this.connection.onStatus(connection => {
      this.store.patch({ connection });
      if (connection === 'offline' && this.store.get().account) {
        void managerRequest<{ account: AccountView | null }>('session').then(({ account }) => {
          if (!account) { this.connection.disconnect(); this.store.patch({ account: null, view: null, authError: 'Your session ended. Please sign in again.' }); }
        }).catch(() => {});
      }
    });
    this.connection.onMessage(message => this.handle(message));
    this.store.subscribe(state => this.render(state));
    this.render(this.store.get());
    void managerRequest<{ account: AccountView | null }>('session').then(({ account }) => {
      this.store.patch({ account, authReady: true, playerName: account?.username ?? '' });
      if (account) this.connection.connect();
    }).catch(() => this.store.patch({ authReady: true, authError: 'Cannot reach the game server. Reload to try again.' }));
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
        this.connection.setOnline();
        this.store.patch({ clockOffset: message.serverNow - Date.now() });
        if (this.identity.roomCode) this.connection.send({ type: 'joinRoom', code: this.identity.roomCode });
        break;
      case 'state':
        if (this.identity.roomCode !== message.view.roomCode) this.identity.roomCode = message.view.roomCode;
        this.store.patch({ view: message.view, clockOffset: message.view.serverNow - Date.now() });
        break;
      case 'roomLeft':
        this.identity.roomCode = null;
        this.store.patch({ view: null });
        break;
      case 'error':
        this.toaster.show(message.message, 'error');
        if ((message.code === 'room_not_found' || message.code === 'room_full') && !this.store.get().view) {
          this.identity.roomCode = null;
        }
        break;
    }
  }

  private render(state: ClientState): void {
    const kind: ScreenKind = !state.account ? 'account' : !state.view ? 'home' : state.view.phase === 'lobby' ? 'lobby' : 'match';
    if (kind !== this.screenKind) {
      this.screen?.destroy();
      this.screen = kind === 'account' ? new AccountScreen(this.context) : kind === 'home' ? new HomeScreen(this.context) : kind === 'lobby' ? new LobbyScreen(this.context) : new MatchScreen(this.context);
      this.screenKind = kind;
      this.host.replaceChildren(this.screen.element);
    }
    this.screen?.update(state);

    this.connectionBadge.className = `conn-badge conn-badge--${state.account ? state.connection : 'online'}`;
    setText(this.connectionBadge, state.connection === 'online' ? '' : state.connection === 'connecting' ? 'Connecting…' : 'Offline — reconnecting…');
  }

  private createActions(): GameActions {
    const send = this.connection.send.bind(this.connection);
    return {
      signIn: (username, password, register) => {
        if (this.store.get().authBusy) return;
        this.store.patch({ authBusy: true, authError: '' });
        void managerRequest<{ account: AccountView }>(register ? 'register' : 'login', { username, password }).then(({ account }) => {
          this.store.patch({ account, playerName: account.username });
          this.connection.connect();
        }).catch(error => this.store.patch({ authError: String(error.message) })).finally(() => this.store.patch({ authBusy: false }));
      },
      signOut: () => {
        void managerRequest('logout', {}).then(() => {
          this.connection.disconnect();
          this.identity.roomCode = null;
          this.store.patch({ account: null, view: null, authError: '' });
        }).catch(error => this.toaster.show(error.message, 'error'));
      },
      createRoom: opponent => send({ type: 'createRoom', opponent }),
      joinRoom: code => send({ type: 'joinRoom', code: code.trim().toUpperCase() }),
      leaveRoom: () => send({ type: 'leaveRoom' }),
      setLineup: lineup => send({ type: 'setLineup', lineup }),
      setReady: ready => send({ type: 'setReady', ready }),
      playCard: cardInstanceId => send({ type: 'playCard', cardInstanceId }),
      setMentality: value => send({ type: 'setMentality', value }),
      requestRematch: () => send({ type: 'requestRematch' }),
      shareLink: code => this.identity.shareLink(code),
    };
  }
}
