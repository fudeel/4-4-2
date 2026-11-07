import { h } from '../dom';

export type ToastKind = 'error' | 'info' | 'success';

/** Short, non-blocking notifications at the top of the screen. */
export class Toaster {
  readonly element = h('div', { class: 'toaster', 'aria-live': 'polite' });

  show(message: string, kind: ToastKind = 'info', durationMs = 2800): void {
    const toast = h('div', { class: `toast toast--${kind}` }, message);
    this.element.appendChild(toast);
    while (this.element.childElementCount > 3) this.element.firstElementChild?.remove();
    setTimeout(() => {
      toast.classList.add('toast--leaving');
      setTimeout(() => toast.remove(), 300);
    }, durationMs);
  }
}
