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

type ScreenKind = 'home' | 'lobby' | 'match';

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
    this.connection.onStatus(connection => this.store.patch({ connection }));
    this.connection.onMessage(message => this.handle(message));
    this.store.subscribe(state => this.render(state));
    this.render(this.store.get());
    this.connection.connect();
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
    const kind: ScreenKind = !state.view ? 'home' : state.view.phase === 'lobby' ? 'lobby' : 'match';
    if (kind !== this.screenKind) {
      this.screen?.destroy();
      this.screen = kind === 'home' ? new HomeScreen(this.context) : kind === 'lobby' ? new LobbyScreen(this.context) : new MatchScreen(this.context);
      this.screenKind = kind;
      this.host.replaceChildren(this.screen.element);
    }
    this.screen?.update(state);

    this.connectionBadge.className = `conn-badge conn-badge--${state.connection}`;
    setText(this.connectionBadge, state.connection === 'online' ? '' : state.connection === 'connecting' ? 'Connecting…' : 'Offline — reconnecting…');
  }

  private createActions(): GameActions {
    const send = this.connection.send.bind(this.connection);
    return {
      setName: name => {
        this.identity.name = name;
        this.store.patch({ playerName: this.identity.name });
        send({ type: 'hello', clientId: this.identity.clientId, name: this.identity.name });
      },
      createRoom: opponent => send({ type: 'createRoom', opponent }),
      joinRoom: code => send({ type: 'joinRoom', code: code.trim().toUpperCase() }),
      leaveRoom: () => send({ type: 'leaveRoom' }),
      setLineup: lineup => send({ type: 'setLineup', lineup }),
      setReady: ready => send({ type: 'setReady', ready }),
      playCard: cardInstanceId => send({ type: 'playCard', cardInstanceId }),
      requestRematch: () => send({ type: 'requestRematch' }),
      shareLink: code => this.identity.shareLink(code),
    };
  }
}
