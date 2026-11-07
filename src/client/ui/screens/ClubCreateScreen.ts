import type { ClientState } from '../../state/GameStore';
import { h, setText } from '../dom';
import type { Screen, ScreenContext } from './Screen';

export class ClubCreateScreen implements Screen {
  readonly element: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private readonly status = h('p', { role: 'status', class: 'account-status' });
  constructor(ctx: ScreenContext) {
    const name = h('input', { class: 'input', required: true, minlength: 3, maxlength: 28, 'aria-label': 'Club name', placeholder: 'Friday Night FC' });
    const shortName = h('input', { class: 'input', required: true, minlength: 2, maxlength: 4, pattern: '[A-Za-z]{2,4}', 'aria-label': 'Abbreviation', placeholder: 'FNF' });
    const color = h('input', { class: 'input club-color', type: 'color', value: '#d43d4f', 'aria-label': 'Club colour' });
    this.submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Found my club');
    this.element = h('main', { class: 'home' },
      h('header', { class: 'home__hero' }, h('p', { class: 'eyebrow' }, 'A CLUB OF YOUR OWN'), h('h1', null, 'Start small. Dream big.'), h('p', { class: 'home__tagline' }, 'Your first twelve players are ready. Give them a badge to play for.')),
      h('section', { class: 'club-metrics' }, ...[['100,000', 'Club budget'], ['12', 'Basic players'], ['50', 'Founding fans'], ['Level 1', 'Stadium']].map(([value, label]) => h('div', { class: 'panel metric' }, h('strong', null, value), h('span', null, label)))),
      h('form', { class: 'panel home__panel', onSubmit: (e: SubmitEvent) => { e.preventDefault(); ctx.actions.createClub(name.value, shortName.value, color.value); } },
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Club name'), name),
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Abbreviation · 2–4 letters'), shortName),
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Club colour'), color),
        h('p', { class: 'muted' }, 'A basic training ground is included. Build your youth academy when you are ready.'), this.status, this.submit),
      h('button', { class: 'btn btn--ghost', onClick: () => ctx.actions.signOut() }, 'Sign out'),
    );
  }
  update(state: ClientState): void {
    this.submit.disabled = !state.clubReady || state.clubBusy;
    setText(this.status, !state.clubReady ? 'Opening your club…' : state.clubBusy ? 'Founding your club…' : state.clubError);
  }
  destroy(): void {}
}
