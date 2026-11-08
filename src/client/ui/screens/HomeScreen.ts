import { CARD_DEFINITIONS, CARD_IDS } from '../../../shared/model/cards';
import { money, stadiumCapacity, type ClubView } from '../../../shared/model/club';
import type { ExhibitionOptions } from '../../../shared/model/exhibition';
import type { ClientState } from '../../state/GameStore';
import { ClubSquadPanel } from '../components/ClubSquadPanel';
import { ProgressionPanel } from '../components/ProgressionPanel';
import { cardView } from '../match/CardView';
import { h, render, setText } from '../dom';
import { ART, artImage, footballerCard, gameTile, wordmark } from '../football';
import type { Screen, ScreenContext } from './Screen';

type Menu = 'play' | 'exhibition' | 'squad' | 'club' | 'develop' | 'rules';
const TABS = [{ id: 'play', name: 'Play' }, { id: 'squad', name: 'Squad' }, { id: 'club', name: 'My club' }, { id: 'develop', name: 'Develop' }, { id: 'rules', name: 'How to play' }] as const;

/** A console-style football hub. Each section owns its scroll area inside the 16:9 surface. */
export class HomeScreen implements Screen {
  readonly element: HTMLElement;
  private menu: Menu = 'play';
  private readonly panes = new Map<Menu, HTMLElement>();
  private readonly tabs = new Map<string, HTMLButtonElement>();
  private readonly wallet = h('strong');
  private readonly name = h('strong');
  private readonly badge = h('span', { class: 'header-crest' });
  private readonly connection = h('span', { class: 'game-connection' });
  private readonly clubBody = h('div', { class: 'club-room' });
  private readonly roster = h('div', { class: 'squad-gallery' });
  private readonly squad: ClubSquadPanel;
  private readonly progression: ProgressionPanel;
  private readonly gameButtons: HTMLButtonElement[] = [];
  private lastClub: ClubView | null = null;
  private selectedPlayer: string | null = null;
  private readonly pace = h('select', { class: 'input', 'aria-label': 'Exhibition length' }, h('option', { value: 'quick' }, 'Quick · 6 turns'), h('option', { value: 'classic' }, 'Classic · 18 turns'));
  private readonly difficulty = h('select', { class: 'input', 'aria-label': 'AI difficulty' }, h('option', { value: 'casual' }, 'Casual AI'), h('option', { value: 'balanced', selected: true }, 'Balanced AI'), h('option', { value: 'challenging' }, 'Challenging AI'));
  private readonly fairPlay = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Fair play' });
  private readonly code: HTMLInputElement;

  constructor(private readonly ctx: ScreenContext) {
    this.squad = new ClubSquadPanel(ctx);
    this.progression = new ProgressionPanel(ctx);
    this.code = h('input', { class: 'input input--code', maxlength: 4, minlength: 4, required: true, pattern: '[A-Z0-9]{4}', placeholder: 'CODE', 'aria-label': 'Room code', autocapitalize: 'characters', onInput: () => { this.code.value = this.code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); } });
    const nav = h('nav', { class: 'game-tabs', role: 'tablist', 'aria-label': 'Club navigation', onKeydown: (e: KeyboardEvent) => this.navigate(e) });
    for (const [index, tab] of TABS.entries()) {
      const button = h('button', { role: 'tab', id: `tab-${tab.id}`, 'aria-controls': `pane-${tab.id}`, onClick: () => this.show(tab.id) }, h('small', null, `0${index + 1}`), tab.name);
      this.tabs.set(tab.id, button); nav.append(button);
    }
    const play = h('section', { class: 'play-grid' },
      gameTile({ image: ART.match, tone: 'cyan', label: 'THE PITCH IS CALLING', title: 'PLAY\nYOUR WAY.', text: 'Six players. One game plan. Everything to play for.', action: 'Kick off', hero: true, onClick: () => this.show('exhibition') }),
      gameTile({ image: ART.night, tone: 'pink', label: '2–8 MANAGERS · ONE TROPHY', title: 'FRIENDS NIGHT', text: 'Bring the group. Take the bragging rights.', action: 'Get the night started', onClick: () => ctx.actions.openNight() }),
      gameTile({ image: ART.match, tone: 'lime', label: 'BUILD YOUR STARTING VI', title: 'YOUR SQUAD', text: 'Find your shape. Back your players.', action: 'Team management', onClick: () => this.show('squad') }),
      gameTile({ image: ART.stadium, tone: 'orange', label: 'FROM LOCAL TO LEGEND', title: 'LEVEL UP', text: 'Better players. Bigger nights.', action: 'Club development', onClick: () => this.show('develop') }));
    const create = (kind: 'human' | 'bot', label: string, text: string, tone: string) => {
      const button = gameTile({ image: kind === 'human' ? ART.night : ART.match, tone, label: kind === 'human' ? 'HEAD TO HEAD' : 'TAKE ON THE AI', title: label, text, action: kind === 'human' ? 'Create a room' : 'Start practice', onClick: () => this.create(kind) });
      this.gameButtons.push(button); return button;
    };
    const join = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Join match →'); this.gameButtons.push(join);
    const exhibition = h('section', { class: 'exhibition-room' },
      h('div', { class: 'section-heading' }, h('button', { class: 'btn btn--ghost btn--small', onClick: () => this.show('play') }, '← Back'), h('h1', null, 'KICK OFF')),
      h('div', { class: 'exhibition-tiles' }, create('human', 'PLAY A FRIEND', 'Your club versus theirs. Settle it on the pitch.', 'pink'), create('bot', 'PRACTICE', 'Try a new shape. Test your next big idea.', 'cyan')),
      h('div', { class: 'match-settings' }, h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Match length'), this.pace), h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'AI difficulty'), this.difficulty), h('label', { class: 'fair-play' }, this.fairPlay, 'Fair play · balance team strength')),
      h('form', { class: 'room-join', onSubmit: (e: SubmitEvent) => { e.preventDefault(); ctx.actions.joinRoom(this.code.value); } }, h('div', null, h('strong', null, 'GOT AN INVITATION?'), h('small', null, 'Enter the four-character match code.')), this.code, join));
    this.addPane('play', play); this.addPane('exhibition', exhibition);
    this.addPane('squad', h('section', { class: 'squad-room' }, this.squad.element, h('section', { class: 'squad-collection' }, h('div', { class: 'section-heading' }, h('h2', null, 'THE CLUB'), h('small', null, 'Your players · your colours')), this.roster)));
    this.addPane('club', this.clubBody); this.addPane('develop', this.progression.element);
    this.addPane('rules', h('section', { class: 'game-rules scroll-area' },
      h('div', { class: 'section-heading' }, h('h1', null, 'KNOW THE GAME'), h('small', null, 'Outthink the other touchline.')),
      h('div', { class: 'rules-steps' }, ...[
        ['01', 'PICK YOUR SIX', 'Pick a shape and a starting six. Players in their natural positions perform better.'],
        ['02', 'MAKE YOUR MOVE', 'Secretly play a card or skip. Attack and defence alternate. Both cards reveal together.'],
        ['03', 'WIN THE DUELS', 'Build-up → chance → shot. Skills, stamina, cards and momentum shape every roll.'],
        ['04', 'CHANGE THE GAME', 'Move the mentality slider. Use half-time for formation changes and up to three substitutions.'],
      ].map(([number, title, text]) => h('article', null, h('b', null, number), h('h2', null, title), h('p', null, text)))),
      h('p', { class: 'muted' }, 'Quick: 6 turns, 12-second planning, 15-second half-time. Classic: 18 turns, 20-second planning, 45-second half-time.'),
      h('h2', null, 'YOUR PLAYBOOK'), h('div', { class: 'playbook' }, ...CARD_IDS.map(id => cardView(CARD_DEFINITIONS[id])))));
    const content = h('div', { class: 'game-home__content' }, ...this.panes.values());
    this.element = h('main', { class: 'game-home' },
      h('header', { class: 'game-header' }, wordmark(), h('div', { class: 'game-club-id' }, this.badge, h('div', null, h('small', null, 'YOUR CLUB'), this.name)),
        h('div', { class: 'game-wallet' }, h('span', { 'aria-hidden': 'true' }, '◈'), h('div', null, h('small', null, 'CLUB CREDITS'), this.wallet)),
        h('button', { class: 'game-account', onClick: () => ctx.actions.signOut(), title: 'Sign out' }, h('span', null, ctx.store.get().account?.username ?? 'Manager'), h('small', null, 'SIGN OUT ↗'))),
      nav, content,
      h('footer', { class: 'game-footer' }, h('span', null, h('b', null, '↵'), ' Select', h('b', null, '← →'), ' Switch tabs'), h('span', { class: 'game-footer__slogan' }, 'SMALL SIDES. BIG MOMENTS.'), this.connection));
    this.show('play');
  }
  update(state: ClientState): void {
    const club = state.club;
    if (club) {
      setText(this.name, club.team.name); setText(this.wallet, money(club.budget)); setText(this.badge, club.team.shortName); this.badge.style.background = club.team.primaryColor;
      if (this.lastClub !== club) { this.lastClub = club; this.drawClub(club); this.drawRoster(club); }
      this.squad.update(state); this.progression.update(state);
    }
    for (const button of this.gameButtons) button.disabled = state.connection !== 'online';
    setText(this.connection, state.connection === 'online' ? '● ONLINE' : '● CONNECTING');
    this.connection.dataset.online = String(state.connection === 'online');
  }
  destroy(): void {}
  private addPane(menu: Menu, content: HTMLElement): void {
    const pane = h('div', { class: `game-pane game-pane--${menu}`, id: `pane-${menu}`, role: 'tabpanel', 'aria-labelledby': `tab-${menu === 'exhibition' ? 'play' : menu}`, hidden: true }, content);
    this.panes.set(menu, pane);
  }
  private show(menu: Menu): void {
    this.menu = menu;
    for (const [id, pane] of this.panes) pane.hidden = id !== menu;
    for (const [id, button] of this.tabs) { const selected = id === (menu === 'exhibition' ? 'play' : menu); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; }
  }
  private navigate(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = Math.max(0, TABS.findIndex(t => t.id === this.menu || (this.menu === 'exhibition' && t.id === 'play')));
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    this.show(TABS[index]!.id); this.tabs.get(TABS[index]!.id)?.focus();
  }
  private create(opponent: 'human' | 'bot'): void { this.ctx.actions.createRoom(opponent, { pace: this.pace.value as ExhibitionOptions['pace'], difficulty: this.difficulty.value as ExhibitionOptions['difficulty'], fairPlay: this.fairPlay.checked }); }
  private drawRoster(club: ClubView): void {
    render(this.roster, ...club.squad.map(player => footballerCard(player, player.position === 'GK' ? club.team.goalkeeperColor : club.team.primaryColor, this.selectedPlayer === player.id, () => { this.selectedPlayer = this.selectedPlayer === player.id ? null : player.id; this.drawRoster(club); })));
  }
  private drawClub(club: ClubView): void {
    render(this.clubBody,
      h('article', { class: 'stadium-feature' }, artImage(ART.stadium), h('div', null, h('p', { class: 'eyebrow' }, 'THIS IS HOME'), h('h1', null, club.stadium.name), h('span', { class: 'level-stamp' }, `LEVEL ${club.stadium.level}`),
        h('div', { class: 'stadium-numbers' }, h('span', null, h('b', null, stadiumCapacity(club.stadium.level)), ' CAPACITY'), h('span', null, h('b', null, club.fans), ' FANS'), h('span', null, h('b', null, club.morale), ' MORALE')),
        h('button', { class: 'btn btn--primary', onClick: () => this.show('develop') }, 'Build your legacy →'))),
      h('section', { class: 'club-story scroll-area' }, h('p', { class: 'eyebrow' }, 'THE STORY SO FAR'), h('h2', null, 'YOUR COLOURS.\nYOUR CLUB.'),
        h('div', { class: 'club-record' }, ...[[club.record.played, 'PLAYED'], [club.record.wins, 'WON'], [club.record.draws, 'DRAWN'], [club.record.losses, 'LOST']].map(([value, label]) => h('div', null, h('strong', null, value), h('small', null, label)))),
        h('div', { class: 'form-guide' }, h('small', null, 'RECENT FORM'), ...club.form.map(result => h('b', { class: `form-guide--${result}` }, result))),
        h('h3', null, 'TROPHY CABINET'), club.trophies.length ? h('div', { class: 'trophy-cabinet' }, ...club.trophies.slice(-5).reverse().map(t => h('p', null, `${t.rank === 1 ? '🏆' : t.rank === 2 ? '🥈' : '🥉'} ${t.name} · Place ${t.rank}`))) : h('p', { class: 'muted' }, 'An empty shelf. A whole lot of possibility. Win your first friends night.'),
        h('button', { class: 'btn btn--pink', onClick: () => this.ctx.actions.openNight() }, 'Chase your first trophy →'),
        h('details', { class: 'club-ledger' }, h('summary', null, 'Club credits & history'), ...club.ledger.slice(-15).reverse().map(t => h('div', { class: 'ledger-row' }, h('span', null, t.label), h('strong', null, `${t.amount > 0 ? '+' : ''}${money(t.amount)}`)))),
        h('h3', null, 'LAST TIME OUT'), club.history.length ? h('div', null, ...club.history.slice(-5).reverse().map(m => h('div', { class: 'result-row' }, h('b', { class: `form-guide--${m.result}` }, m.result), h('span', null, m.opponent), h('strong', null, `${m.goalsFor}–${m.goalsAgainst}`)))) : h('p', { class: 'muted' }, 'Your first match is waiting.')));
  }
}
