import type { CardDefinition } from '../../../shared/model/cards';
import { h } from '../dom';
import { TIMING_LABEL } from '../format';
import { ART, artImage } from '../football';

export interface CardViewOptions {
  selected?: boolean;
  disabled?: boolean;
  reason?: string;
  compact?: boolean;
  onClick?: () => void;
}

/** A playing card: timing on top, big icon, name and effect. Rarity sets the frame colour. */
export function cardView(card: CardDefinition, options: CardViewOptions = {}): HTMLElement {
  return h('button', {
    class: [
      'card',
      `card--${card.rarity}`,
      `card--${card.timing}`,
      options.selected ? 'card--selected' : '',
      options.disabled ? 'card--disabled' : '',
      options.compact ? 'card--compact' : '',
    ].join(' '),
    'aria-pressed': options.selected ? 'true' : 'false',
    'aria-disabled': options.disabled ? 'true' : 'false',
    onClick: options.onClick,
  },
    artImage(card.timing === 'attack' ? ART.match : card.timing === 'defense' ? ART.stadium : ART.night, 'card__art'),
    h('span', { class: 'card__timing' }, TIMING_LABEL[card.timing]),
    h('span', { class: 'card__icon' }, card.icon),
    h('strong', { class: 'card__name' }, card.name),
    options.compact ? null : h('span', { class: 'card__desc' }, card.description),
    options.reason ? h('span', { class: 'card__reason' }, options.reason) : null,
  );
}

export function cardBack(): HTMLElement {
  return h('span', { class: 'card-back', 'aria-hidden': 'true' });
}
