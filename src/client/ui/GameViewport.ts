import { h } from './dom';

/** One 16:9 game surface. Rotating the phone changes layout without remounting the match. */
export class GameViewport {
  readonly frame = h('div', { class: 'game-viewport' });
  readonly element: HTMLElement;
  private readonly portrait = window.matchMedia('(orientation: portrait) and (max-width: 1100px)');
  private readonly prompt = h('section', { class: 'rotate-prompt', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rotate-title', hidden: true },
    h('div', { class: 'rotate-phone', 'aria-hidden': 'true' }, h('span', null, '↻')),
    h('p', { class: 'eyebrow' }, 'FOOTBALL IS A WIDESCREEN GAME'),
    h('h1', { id: 'rotate-title' }, 'TURN YOUR', h('br'), 'GAME AROUND.'),
    h('p', null, 'Rotate your phone to landscape for the full 16:9 experience.'),
    h('small', null, 'Your club and match stay right here.'),
  );
  constructor() {
    this.element = h('div', { class: 'game-viewport-shell' }, this.frame, this.prompt);
    this.portrait.addEventListener('change', this.sync);
    this.sync();
  }
  private readonly sync = (): void => {
    const rotate = this.portrait.matches;
    this.prompt.hidden = !rotate;
    this.frame.inert = rotate;
    this.frame.setAttribute('aria-hidden', String(rotate));
  };
}
