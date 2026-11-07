import { CARD_DEFINITIONS } from '../../../shared/model/cards';
import { otherSide, type ActionReport, type DiceRoll, type MatchEvent, type MatchView } from '../../../shared/model/match';
import { h, render } from '../dom';
import { pct, playerById, shortName } from '../format';
import { cardView } from './CardView';

/** Transient centre-screen moments: card reveal, dice rolls, goals, bookings. */
export class MatchOverlays {
  readonly element = h('div', { class: 'overlays' });
  private readonly reveal = h('div', { class: 'overlay overlay--reveal' });
  private readonly roll = h('div', { class: 'roll-chip' });
  private readonly banner = h('div', { class: 'overlay overlay--banner' });
  private readonly booking = h('div', { class: 'overlay overlay--booking' });
  private readonly timers = new Map<HTMLElement, number>();

  constructor() {
    this.element.append(this.reveal, this.banner, this.booking, this.roll);
  }

  showReveal(report: ActionReport, view: MatchView, durationMs: number): void {
    const slot = (side: 'home' | 'away', label: string) => {
      const card = report.revealed.find(c => c.side === side);
      const team = view.teams[side].team;
      return h('div', { class: `reveal__slot ${card?.cancelled ? 'reveal__slot--cancelled' : ''}` },
        h('span', { class: 'reveal__who', style: { color: team.primaryColor } }, label),
        card ? cardView(CARD_DEFINITIONS[card.cardId], { compact: true }) : h('div', { class: 'reveal__none' }, 'No card'),
        card?.cancelled ? h('span', { class: 'reveal__cancelled' }, 'Cancelled') : null,
      );
    };
    render(this.reveal, slot(view.you, 'You'), h('span', { class: 'reveal__vs' }, 'VS'), slot(otherSide(view.you), 'Them'));
    this.flash(this.reveal, durationMs);
  }

  showRoll(roll: DiceRoll, view: MatchView, durationMs: number): void {
    const forYou = roll.side === view.you;
    const good = roll.success === forYou;
    const team = view.teams[roll.side].team;
    render(this.roll,
      h('span', { class: 'roll-chip__team', style: { background: team.primaryColor } }, team.shortName),
      h('span', null, roll.label),
      h('b', null, pct(roll.chance)),
      h('span', { class: 'roll-chip__die' }, `🎲 ${Math.floor(roll.roll * 100)}`),
      h('span', { class: `roll-chip__verdict ${good ? 'is-good' : 'is-bad'}` }, roll.success ? '✓' : '✗'),
    );
    this.flash(this.roll, durationMs + 400);
  }

  showGoal(event: MatchEvent, view: MatchView, durationMs: number): void {
    const scorer = playerById(view, event.actorId);
    const team = view.teams[event.side].team;
    const yours = event.side === view.you;
    render(this.banner,
      h('div', { class: 'goal', style: { '--team': team.primaryColor } as Record<string, string> },
        h('strong', null, 'GOAL!'),
        h('span', null, scorer ? `${scorer.player.number} ${shortName(scorer.player)}` : team.name),
        h('small', null, yours ? 'Get in!' : team.name),
      ),
    );
    this.flash(this.banner, durationMs);
  }

  showBanner(text: string, color: string, durationMs: number): void {
    render(this.banner, h('div', { class: 'callout', style: { borderColor: color } }, text));
    this.flash(this.banner, durationMs);
  }

  showBooking(event: MatchEvent, view: MatchView): void {
    if (!event.booking) return;
    const who = playerById(view, event.booking.playerId);
    render(this.booking,
      h('div', { class: `booking booking--${event.booking.card}` }),
      h('span', null, who ? shortName(who.player) : '', event.booking.card === 'red' ? ' — SENT OFF!' : ' booked'),
    );
    this.flash(this.booking, 1800);
  }

  clear(): void {
    for (const el of [this.reveal, this.roll, this.banner, this.booking]) el.classList.remove('is-visible');
  }

  private flash(el: HTMLElement, durationMs: number): void {
    window.clearTimeout(this.timers.get(el));
    el.classList.add('is-visible');
    this.timers.set(el, window.setTimeout(() => el.classList.remove('is-visible'), durationMs));
  }
}
