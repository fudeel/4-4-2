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
import type { ClubView } from '../shared/model/club';
import { ClubCreateScreen } from './ui/screens/ClubCreateScreen';
import type { NightView } from '../shared/model/night';
import { NightScreen } from './ui/screens/NightScreen';
import { GameViewport } from './ui/GameViewport';

type ScreenKind = 'account' | 'club' | 'home' | 'night' | 'lobby' | 'match';

/** Wires network ↔ store ↔ screens and switches screens as the match progresses. */
export class App {
  private screen: Screen | null = null;
  private screenKind: ScreenKind | null = null;
  private readonly toaster = new Toaster();
  private readonly host = h('div', { class: 'screen-host' });
  private readonly connectionBadge = h('div', { class: 'conn-badge' });
  private readonly context: ScreenContext;
  private readonly viewport = new GameViewport();
  private pendingNight = new URLSearchParams(location.search).get('night');

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
    this.viewport.frame.append(this.host, this.toaster.element, this.connectionBadge);
    this.root.append(this.viewport.element);
    this.connection.onOpen(() => this.connection.send({ type: 'hello', clientId: this.identity.clientId, name: this.identity.name }));
    this.connection.onStatus(connection => {
      this.store.patch({ connection });
      if (connection === 'offline' && this.store.get().account) {
        void managerRequest<{ account: AccountView | null }>('session').then(({ account }) => {
          if (!account) { this.store.patch({ account: null, club: null, clubReady: false, night: null, nightOpen: false, view: null, authError: 'Your session ended. Please sign in again.' }); this.connection.disconnect(); }
        }).catch(() => {});
      }
    });
    this.connection.onMessage(message => this.handle(message));
    this.store.subscribe(state => this.render(state));
    this.render(this.store.get());
    void managerRequest<{ account: AccountView | null }>('session').then(({ account }) => {
      this.store.patch({ account, authReady: true, playerName: account?.username ?? '' });
      if (account) { this.loadClub(); this.connection.connect(); }
    }).catch(() => this.store.patch({ authReady: true, authError: 'Cannot reach the game server. Reload to try again.' }));
  }

  private loadClub(): void {
    const accountId = this.store.get().account?.id;
    void managerRequest<{ club: ClubView | null }>('club').then(({ club }) => {
      if (this.store.get().account?.id === accountId) { this.store.patch({ club, clubReady: true }); if (club) this.loadNight(); }
    }).catch(error => this.store.patch({ clubReady: true, clubError: error.message }));
  }

  private loadNight(): void {
    if (this.pendingNight) {
      const code = this.pendingNight; this.pendingNight = null;
      this.context.actions.joinNight(code);
    } else this.context.actions.refreshNight();
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
        this.connection.setOnline();
        this.store.patch({ clockOffset: message.serverNow - Date.now() });
        if (this.identity.roomCode) this.connection.send({ type: 'joinRoom', code: this.identity.roomCode });
        break;
      case 'state':
        if (message.view.phase === 'fulltime' && this.store.get().view?.phase !== 'fulltime') this.loadClub();
        if (this.identity.roomCode !== message.view.roomCode) this.identity.roomCode = message.view.roomCode;
        this.store.patch({ view: message.view, clockOffset: message.view.serverNow - Date.now() });
        break;
      case 'roomLeft':
        this.identity.roomCode = null;
        this.store.patch({ nightOpen: !!this.store.get().view?.nightCode, view: null });
        this.loadClub();
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
    const kind: ScreenKind = !state.account ? 'account' : !state.clubReady || !state.club ? 'club' : !state.view ? state.nightOpen ? 'night' : 'home' : state.view.phase === 'lobby' ? 'lobby' : 'match';
    if (kind !== this.screenKind) {
      this.screen?.destroy();
      this.screen = kind === 'account' ? new AccountScreen(this.context) : kind === 'club' ? new ClubCreateScreen(this.context) : kind === 'home' ? new HomeScreen(this.context) : kind === 'night' ? new NightScreen(this.context) : kind === 'lobby' ? new LobbyScreen(this.context) : new MatchScreen(this.context);
      this.screenKind = kind;
      this.host.replaceChildren(this.screen.element);
    }
    this.screen?.update(state);

    this.connectionBadge.className = `conn-badge conn-badge--${state.account ? state.connection : 'online'}`;
    setText(this.connectionBadge, state.connection === 'online' ? '' : state.connection === 'connecting' ? 'Connecting…' : 'Offline — reconnecting…');
  }

  private createActions(): GameActions {
    const send = this.connection.send.bind(this.connection);
    const nightAction = (path: string, data: object = {}) => {
      if (this.store.get().nightBusy) return;
      const ownerId = this.store.get().account?.id;
      this.store.patch({ nightBusy: true, nightError: '' });
      void managerRequest<{ night: NightView | null; roomCode?: string }>(`night/${path}`, { code: this.store.get().night?.code, ...data }).then(result => {
        if (this.store.get().account?.id !== ownerId) return;
        this.store.patch({ night: result.night, nightOpen: true });
        if (result.roomCode) send({ type: 'joinRoom', code: result.roomCode });
        if (result.night?.phase === 'finished') this.loadClub();
      }).catch(error => this.store.patch({ nightError: error.message })).finally(() => this.store.patch({ nightBusy: false }));
    };
    const changeClub = (path: string, data: unknown) => {
      if (this.store.get().clubBusy) return;
      const accountId = this.store.get().account?.id;
      this.store.patch({ clubBusy: true, clubError: '' });
      void managerRequest<{ club: ClubView }>(`club/${path}`, data).then(({ club }) => {
        if (this.store.get().account?.id === accountId) { this.store.patch({ club }); this.toaster.show('Club updated.', 'success'); }
      }).catch(error => { this.store.patch({ clubError: error.message }); this.toaster.show(error.message, 'error'); }).finally(() => this.store.patch({ clubBusy: false }));
    };
    return {
      openNight: () => { this.store.patch({ nightOpen: true }); this.context.actions.refreshNight(); },
      closeNight: () => this.store.patch({ nightOpen: false }),
      createNight: name => nightAction('create', { name }),
      joinNight: code => nightAction('join', { code: code.trim().toUpperCase() }),
      startNight: () => nightAction('start'),
      leaveNight: () => nightAction('leave'),
      playFixture: fixtureId => nightAction('play', { fixtureId }),
      concedeFixture: fixtureId => nightAction('concede', { fixtureId }),
      refreshNight: () => {
        const ownerId = this.store.get().account?.id;
        if (!ownerId || this.store.get().nightBusy) return;
        const code = this.store.get().night?.code;
        void managerRequest<{ night: NightView | null }>(code ? `night?code=${encodeURIComponent(code)}` : 'night/current').then(({ night }) => {
          if (this.store.get().account?.id === ownerId && !this.store.get().nightBusy) this.store.patch({ night });
        }).catch(error => { if (this.store.get().nightOpen) this.store.patch({ nightError: error.message }); });
      },
      saveClubLineup: lineup => changeClub('lineup', { lineup }),
      releasePlayer: playerId => changeClub('release', { playerId }),
      upgradeFacility: facility => changeClub('upgrade', { facility }),
      trainPlayer: (playerId, attribute) => changeClub('train', { playerId, attribute }),
      promoteProspect: playerId => changeClub('promote', { playerId }),
      createClub: (name, shortName, color) => {
        if (this.store.get().clubBusy) return;
        this.store.patch({ clubBusy: true, clubError: '' });
        void managerRequest<{ club: ClubView }>('club', { name, shortName, color }).then(({ club }) => { this.store.patch({ club, clubReady: true }); this.loadNight(); }).catch(error => this.store.patch({ clubError: error.message })).finally(() => this.store.patch({ clubBusy: false }));
      },
      signIn: (username, password, register) => {
        if (this.store.get().authBusy) return;
        this.store.patch({ authBusy: true, authError: '' });
        void managerRequest<{ account: AccountView }>(register ? 'register' : 'login', { username, password }).then(({ account }) => {
          this.store.patch({ account, playerName: account.username });
          this.loadClub();
          this.connection.connect();
        }).catch(error => this.store.patch({ authError: String(error.message) })).finally(() => this.store.patch({ authBusy: false }));
      },
      signOut: () => {
        send({ type: 'leaveRoom' });
        void managerRequest('logout', {}).then(() => {
          this.identity.roomCode = null;
          this.store.patch({ account: null, club: null, clubReady: false, night: null, nightOpen: false, view: null, authError: '' });
          this.connection.disconnect();
        }).catch(error => this.toaster.show(error.message, 'error'));
      },
      createRoom: (opponent, options) => send({ type: 'createRoom', opponent, options }),
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
