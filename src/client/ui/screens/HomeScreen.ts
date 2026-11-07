import { CARD_DEFINITIONS, CARD_IDS } from '../../../shared/model/cards';
import { DEFAULT_RULES, totalTurns, turnsPerHalf } from '../../../shared/rules';
import type { ClientState } from '../../state/GameStore';
import { h } from '../dom';
import { TIMING_LABEL } from '../format';
import type { Screen, ScreenContext } from './Screen';

/** Landing page: name, create/join a room, practice vs AI, rules. */
export class HomeScreen implements Screen {
  readonly element: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly codeInput: HTMLInputElement;

  constructor(private readonly ctx: ScreenContext) {
    const { actions } = ctx;
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
    this.element = h('main', { class: 'home' },
      h('header', { class: 'home__hero' },
        h('div', { class: 'logo' }, h('span', null, '4'), h('i', null, '-'), h('span', null, '4'), h('i', null, '-'), h('span', null, '2')),
        h('p', { class: 'home__tagline' }, 'Turn-based 6-a-side football. Pick your shape, play your cards, roll the dice.'),
      ),
      h('section', { class: 'panel home__panel' },
        h('p', null, `Manager ${ctx.store.get().account?.username ?? ''}`),
        h('button', { class: 'btn btn--ghost', onClick: () => actions.signOut() }, 'Sign out'),
        button('⚔️  Play a friend', 'btn--primary btn--block', () => this.create('human')),
        button('🤖  Practice vs AI', 'btn--ghost btn--block', () => this.create('bot')),
        h('div', { class: 'divider' }, h('span', null, 'or join a room')),
        h('div', { class: 'join-row' }, this.codeInput, button('Join', 'btn--primary', () => this.join())),
      ),
      h('details', { class: 'panel rules' },
        h('summary', null, '📖 How to play'),
        h('ul', null,
          h('li', null, `Two managers, 6 players each. A match is 2 × ${DEFAULT_RULES.halfLengthMinutes} minutes; every turn covers ${DEFAULT_RULES.minutesPerTurn} minutes (${half} turns per half, ${totalTurns(DEFAULT_RULES)} in total).`),
          h('li', null, 'Possession alternates: one team attacks, the other defends. Each attack is a chain of dice rolls — build-up, chance creation, shot — whose odds come from the stats, fatigue and positions of the players involved.'),
          h('li', null, `Both managers secretly play one card (or skip) within ${DEFAULT_RULES.planningSeconds}s. Cards are revealed together. You hold up to ${DEFAULT_RULES.handLimit} and draw one every ${DEFAULT_RULES.drawEveryTurns} turns; hands refill at half-time.`),
          h('li', null, `Players tire as the match goes on. At half-time (${DEFAULT_RULES.halfTimeSeconds}s) you can change formation and make up to ${DEFAULT_RULES.maxSubstitutions} substitutions.`),
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
      h('footer', { class: 'home__footer' }, 'Friends join with their own accounts. Use a different browser or a private window for a second manager on this computer.'),
    );
  }

  update(state: ClientState): void {
    const offline = state.connection !== 'online';
    for (const btn of this.buttons) btn.disabled = offline;
  }

  destroy(): void {
    // Nothing to clean up.
  }

  private create(opponent: 'human' | 'bot'): void {
    this.ctx.actions.createRoom(opponent);
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
