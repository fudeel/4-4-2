import { CARD_DEFINITIONS, CARD_IDS } from '../../../shared/model/cards';
import { DEFAULT_RULES, totalTurns, turnsPerHalf } from '../../../shared/rules';
import type { ClientState } from '../../state/GameStore';
import { h, render } from '../dom';
import { money, stadiumCapacity, type ClubView } from '../../../shared/model/club';
import { ATTRIBUTE_LABELS, overallRating } from '../../../shared/model/player';
import type { ExhibitionOptions } from '../../../shared/model/exhibition';
import { ProgressionPanel } from '../components/ProgressionPanel';
import { ClubSquadPanel } from '../components/ClubSquadPanel';
import { TIMING_LABEL } from '../format';
import type { Screen, ScreenContext } from './Screen';

/** Landing page: name, create/join a room, practice vs AI, rules. */
export class HomeScreen implements Screen {
  readonly element: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly codeInput: HTMLInputElement;
  private readonly clubPanel = h('section', { class: 'club-overview' });
  private lastClub: ClubView | null = null;
  private readonly progression: ProgressionPanel;
  private readonly squad: ClubSquadPanel;
  private readonly pace = h('select', { class: 'input', 'aria-label': 'Exhibition length' }, h('option', { value: 'quick' }, 'Quick · 6 turns'), h('option', { value: 'classic' }, 'Classic · 18 turns'));
  private readonly difficulty = h('select', { class: 'input', 'aria-label': 'AI difficulty' }, h('option', { value: 'casual' }, 'AI · Casual'), h('option', { value: 'balanced', selected: true }, 'AI · Balanced'), h('option', { value: 'challenging' }, 'AI · Challenging'));
  private readonly fairPlay = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Fair play' });

  constructor(private readonly ctx: ScreenContext) {
    const { actions } = ctx;
    this.progression = new ProgressionPanel(ctx);
    this.squad = new ClubSquadPanel(ctx);
    this.progression.element.id = 'development';
    this.codeInput = h('input', {
      class: 'input input--code', maxlength: 4, placeholder: 'CODE', 'aria-label': 'Room code', autocapitalize: 'characters',
      onInput: () => { this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); },
      onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') this.join(); },
    });

    const button = (label: string, cls: string, onClick: () => void) => {
      const btn = h('button', { class: `btn ${cls}`, onClick }, label);
      this.buttons.push(btn);
      return btn;
    };

    const half = turnsPerHalf(DEFAULT_RULES);
    this.element = h('main', { class: 'home home--club' },
      h('header', { class: 'home__hero' },
        h('div', { class: 'logo' }, h('span', null, '4'), h('i', null, '-'), h('span', null, '4'), h('i', null, '-'), h('span', null, '2')),
        h('p', { class: 'home__tagline' }, 'A small club. A big night. Your story starts here.'),
      ),
      h('nav', { class: 'club-nav', 'aria-label': 'Club navigation' }, h('a', { href: '#exhibitions' }, 'Play'), h('a', { href: '#development' }, 'Develop'), h('button', { onClick: () => actions.openNight() }, 'Friends night'), h('span', null, ctx.store.get().account?.username), h('button', { onClick: () => actions.signOut() }, 'Sign out')),
      this.clubPanel,
      h('section', { class: 'panel home__panel exhibition-panel', id: 'exhibitions' },
        h('h2', { class: 'panel__title' }, 'Exhibition match'),
        this.pace, this.difficulty,
        h('label', { class: 'fair-play' }, this.fairPlay, ' Fair play · balance team strength for a close game'),
        button('⚔️  Play a friend', 'btn--primary btn--block', () => this.create('human')),
        button('🤖  Practice vs AI', 'btn--ghost btn--block', () => this.create('bot')),
        h('div', { class: 'divider' }, h('span', null, 'or join a room')),
        h('div', { class: 'join-row' }, this.codeInput, button('Join', 'btn--primary', () => this.join())),
      ),
      h('button', { class: 'night-launch', onClick: () => actions.openNight() }, h('small', null, 'THE GROUP CHAT MEETS THE PITCH'), h('strong', null, 'Make it a friends night →'), h('span', null, '2–8 managers · Quick matches · Shared table · Trophies')),
      this.squad.element,
      h('details', { class: 'panel rules' },
        h('summary', null, '📖 How to play'),
        h('ul', null,
          h('li', null, `Two managers, 6 players each. Quick matches have 6 turns (30 in-game minutes). Classic matches have ${totalTurns(DEFAULT_RULES)} turns (${half} per half, 90 minutes). Each turn covers ${DEFAULT_RULES.minutesPerTurn} minutes.`),
          h('li', null, 'Possession alternates: one team attacks, the other defends. Each attack is a chain of dice rolls — build-up, chance creation, shot — whose odds come from the stats, fatigue and positions of the players involved.'),
          h('li', null, `Both managers secretly play one card or skip within 12s (quick) or ${DEFAULT_RULES.planningSeconds}s (classic). Cards are revealed together. Hold up to ${DEFAULT_RULES.handLimit}; draw one every ${DEFAULT_RULES.drawEveryTurns} turns.`),
          h('li', null, `Players tire. At half-time (15s quick, ${DEFAULT_RULES.halfTimeSeconds}s classic), change formation and make up to ${DEFAULT_RULES.maxSubstitutions} substitutions.`),
          h('li', null, 'Winning the ball cleanly in midfield springs a counter-attack. Momentum swings with every duel won.'),
        ),
        h('div', { class: 'rules__cards' },
          CARD_IDS.map(id => {
            const card = CARD_DEFINITIONS[id];
            return h('div', { class: `rule-card rule-card--${card.rarity}` },
              h('span', { class: 'rule-card__icon' }, card.icon),
              h('div', null,
                h('strong', null, card.name, ' ', h('em', { class: `timing timing--${card.timing}` }, TIMING_LABEL[card.timing])),
                h('p', null, card.description),
              ),
            );
          }),
        ),
      ),
      this.progression.element,
      h('footer', { class: 'home__footer' }, 'Friends join with their own accounts. Use a different browser or a private window for a second manager on this computer.'),
    );
  }

  update(state: ClientState): void {
    this.progression.update(state);
    this.squad.update(state);
    if (state.club && state.club !== this.lastClub) {
      this.lastClub = state.club;
      const club = state.club;
      render(this.clubPanel,
        h('div', { class: 'club-heading' }, h('div', { class: 'club-badge', style: { background: club.team.primaryColor } }, club.team.shortName), h('div', null, h('p', { class: 'eyebrow' }, 'YOUR CLUB'), h('h1', null, club.team.name))),
        h('div', { class: 'club-metrics' }, ...[[money(club.budget), 'Credits'], [String(club.fans), 'Fans'], [String(club.record.played), 'Matches'], [String(club.morale), 'Morale']].map(([value, label]) => h('div', { class: 'panel metric' }, h('strong', null, value), h('span', null, label)))),
        h('section', { class: 'panel home__panel' }, h('h2', { class: 'panel__title' }, 'Your foundations'),
          h('p', null, `🏟 ${club.stadium.name} · Level ${club.stadium.level} · ${stadiumCapacity(club.stadium.level)} capacity`),
          h('p', null, `⚽ Training ground · Level ${club.trainingLevel}`), h('p', null, club.youthLevel ? `🌱 Youth academy · Level ${club.youthLevel}` : '🌱 Youth academy · Not built'),
          h('p', { class: 'muted' }, `Record: ${club.record.wins}W ${club.record.draws}D ${club.record.losses}L · Reputation ${club.reputation}`)),
        h('details', { class: 'panel' }, h('summary', null, `Your squad · ${club.squad.length} players`),
          h('div', { class: 'squad-list' }, ...club.squad.map(p => h('div', { class: 'squad-player' },
            h('div', null, h('strong', null, `${p.number}. ${p.name}`), h('span', { class: 'muted' }, ` ${p.position} · ${p.age} years · OVR ${Math.round(overallRating(p))}`)),
            h('small', { class: 'muted' }, Object.entries(p.attributes).map(([key, value]) => `${ATTRIBUTE_LABELS[key as keyof typeof ATTRIBUTE_LABELS]} ${value}`).join(' · '))))),
        ),
        h('details', { class: 'panel' }, h('summary', null, 'Club ledger'), ...club.ledger.slice().reverse().map(t => h('div', { class: 'ledger-row' }, h('span', null, t.label), h('strong', null, `${t.amount > 0 ? '+' : ''}${money(t.amount)}`)))),
        club.history.length ? h('section', { class: 'panel' }, h('h2', { class: 'panel__title' }, 'Recent exhibitions'), ...club.history.slice(-5).reverse().map(m => h('div', { class: 'ledger-row' }, h('span', null, `${m.result} · ${m.opponent}`), h('strong', null, `${m.goalsFor}–${m.goalsAgainst}`)))) : null,
        h('section', { class: 'panel home__panel' }, h('h2', { class: 'panel__title' }, 'Club milestones'),
          h('div', { class: 'milestones' }, ...[[club.record.played > 0, 'First whistle'], [club.record.wins > 0, 'First victory'], [club.fans >= 100, 'A hundred voices'], [club.squad.some(p => p.age < 20), 'Homegrown talent'], [club.trophies.some(t => t.rank === 1), 'Night champions']].map(([done, label]) => h('span', { class: done ? 'milestone milestone--done' : 'milestone' }, `${done ? '✓' : '○'} ${label}`))),
          club.trophies.length ? h('div', { class: 'trophy-cabinet' }, ...club.trophies.slice(-5).reverse().map(t => h('p', null, `${t.rank === 1 ? '🏆' : t.rank === 2 ? '🥈' : '🥉'} ${t.name} · Place ${t.rank}`))) : h('p', { class: 'muted' }, 'Your first trophy is a friends night away.')),
      );
    }
    const offline = state.connection !== 'online';
    for (const btn of this.buttons) btn.disabled = offline;
  }

  destroy(): void {
    // Nothing to clean up.
  }

  private create(opponent: 'human' | 'bot'): void {
    this.ctx.actions.createRoom(opponent, { pace: this.pace.value as ExhibitionOptions['pace'], fairPlay: this.fairPlay.checked, difficulty: this.difficulty.value as ExhibitionOptions['difficulty'] });
  }

  private join(): void {
    const code = this.codeInput.value.trim();
    if (code.length < 4) {
      this.ctx.toaster.show('Enter the 4-character room code.', 'error');
      return;
    }
    this.ctx.actions.joinRoom(code);
  }
}
