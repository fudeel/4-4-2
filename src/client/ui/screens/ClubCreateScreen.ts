import type { ClientState } from '../../state/GameStore';
import { h, setText } from '../dom';
import type { Screen, ScreenContext } from './Screen';
import { ART, artImage, kitPortrait, wordmark } from '../football';

export class ClubCreateScreen implements Screen {
  readonly element: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private readonly status = h('p', { role: 'status', class: 'account-status' });
  constructor(ctx: ScreenContext) {
    const previewName = h('strong', { class: 'create-preview__name' }, 'YOUR CLUB');
    const crest = h('span', { class: 'create-preview__crest' }, 'FC');
    const shirt = h('div', { class: 'create-preview__shirt' }, kitPortrait(10, '#d43d4f'));
    const name = h('input', { class: 'input', required: true, minlength: 3, maxlength: 28, 'aria-label': 'Club name', placeholder: 'Friday Night FC', onInput: () => setText(previewName, name.value || 'YOUR CLUB') });
    const shortName = h('input', { class: 'input', required: true, minlength: 2, maxlength: 4, pattern: '[A-Za-z]{2,4}', 'aria-label': 'Abbreviation', placeholder: 'FNF', onInput: () => setText(crest, shortName.value.toUpperCase() || 'FC') });
    const color = h('input', { class: 'input club-color', type: 'color', value: '#d43d4f', 'aria-label': 'Club colour', onInput: () => { crest.style.background = color.value; shirt.replaceChildren(kitPortrait(10, color.value)); } });
    this.submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Found my club');
    this.element = h('main', { class: 'club-create-screen onboarding-screen' },
      h('section', { class: 'onboarding-art onboarding-art--stadium' }, artImage(ART.stadium), wordmark(), h('div', { class: 'onboarding-copy' }, h('p', { class: 'eyebrow' }, 'A BADGE TO PLAY FOR'), h('h1', null, 'LOCAL ROOTS.\nLEGENDARY\nAMBITIONS.')),
        h('div', { class: 'starter-strip' }, ...[['100K', 'CREDITS'], ['12', 'PLAYERS'], ['50', 'FANS'], ['LVL 1', 'STADIUM']].map(([value, label]) => h('span', null, h('strong', null, value), h('small', null, label))))),
      h('form', { class: 'onboarding-form', onSubmit: (e: SubmitEvent) => { e.preventDefault(); ctx.actions.createClub(name.value, shortName.value, color.value); } },
        h('p', { class: 'eyebrow' }, 'YOUR CLUB STARTS HERE'),
        h('div', { class: 'create-preview' }, crest, shirt, previewName),
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Club name'), name),
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Abbreviation · 2–4 letters'), shortName),
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Club colour'), color),
        this.status, this.submit, h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => ctx.actions.signOut() }, 'Sign out'),
        h('p', { class: 'onboarding-footnote' }, 'Training ground included. Youth academy: your next chapter.')),
    );
  }
  update(state: ClientState): void {
    this.submit.disabled = !state.clubReady || state.clubBusy;
    setText(this.status, !state.clubReady ? 'Opening your club…' : state.clubBusy ? 'Founding your club…' : state.clubError);
  }
  destroy(): void {}
}
