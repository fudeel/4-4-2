import { MENTALITY, mentalityBand, mentalitySummary, normalizeMentality } from '../../../shared/model/tactics';
import { h, setText } from '../dom';

export interface MentalityBarOptions {
  onChange(value: number): void;
  /** One tight row for the in-match HUD. */
  compact?: boolean;
}

/** How long a value we just sent wins over (possibly stale) server state. */
const PENDING_MS = 1500;

/**
 * The Defence ↔ Attack slider. Effects update live while dragging; the value is sent on release.
 * The server's value is shown otherwise, so both tabs of a manager stay in sync.
 */
export class MentalityBar {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly name = h('strong', { class: 'mentality__name' });
  private readonly effects = h('span', { class: 'mentality__effects' });
  private dragging = false;
  private pending: { value: number; until: number } | null = null;

  constructor(private readonly options: MentalityBarOptions) {
    this.input = h('input', {
      type: 'range',
      class: 'mentality__range',
      min: MENTALITY.min,
      max: MENTALITY.max,
      step: MENTALITY.step,
      value: MENTALITY.initial,
      'aria-label': 'Mentality, from defend to attack',
    });
    this.input.addEventListener('input', () => {
      this.dragging = true;
      this.show(Number(this.input.value));
    });
    this.input.addEventListener('change', () => this.commit());
    this.input.addEventListener('pointerup', () => { this.dragging = false; });

    const compact = options.compact ?? false;
    this.element = h('div', { class: `mentality ${compact ? 'mentality--compact' : ''}` },
      h('div', { class: 'mentality__row' },
        h('span', { class: 'mentality__end mentality__end--def' }, '🛡️', compact ? null : h('span', null, 'Defend')),
        this.input,
        h('span', { class: 'mentality__end mentality__end--att' }, compact ? null : h('span', null, 'Attack'), '⚔️'),
      ),
      h('div', { class: 'mentality__caption' }, this.name, this.effects),
    );
    this.show(MENTALITY.initial);
  }

  update(value: number, disabled = false): void {
    this.input.disabled = disabled;
    if (this.dragging) return;
    if (this.pending) {
      if (value !== this.pending.value && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    this.input.value = String(value);
    this.show(value);
  }

  private commit(): void {
    this.dragging = false;
    const value = normalizeMentality(Number(this.input.value));
    this.pending = { value, until: Date.now() + PENDING_MS };
    this.show(value);
    this.options.onChange(value);
  }

  private show(value: number): void {
    const band = mentalityBand(value);
    setText(this.name, `${band.icon} ${band.name}`);
    setText(this.effects, mentalitySummary(value).join(' · '));
    const lean = value / MENTALITY.max;
    this.element.dataset.lean = lean < -0.25 ? 'defend' : lean > 0.25 ? 'attack' : 'balanced';
  }
}
