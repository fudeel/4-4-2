import { CARD_DEFINITIONS, isCardPlayable } from '../../../shared/model/cards';
import { otherSide, type MatchView } from '../../../shared/model/match';
import type { GameActions } from '../../state/GameStore';
import { h, render, setText } from '../dom';
import { cardBack, cardView } from './CardView';

/**
 * The manager's controls for the current turn: who attacks, the countdown,
 * the opponent's status and your hand of cards (pick one, or skip).
 */
export class TurnPanel {
  readonly element: HTMLElement;
  private readonly banner = h('div', { class: 'turn__banner' });
  private readonly title = h('strong', { class: 'turn__title' });
  private readonly sub = h('span', { class: 'turn__sub' });
  private readonly timer = h('span', { class: 'turn__timer' });
  private readonly timerFill = h('i');
  private readonly opponent = h('div', { class: 'turn__opponent' });
  private readonly hand = h('div', { class: 'hand' });
  private readonly description = h('p', { class: 'turn__desc' });
  private readonly controls = h('div', { class: 'turn__controls' });
  private selected: string | null = null;
  private turnKey = '';
  private view: MatchView | null = null;

  constructor(private readonly actions: GameActions) {
    this.banner.append(h('div', { class: 'turn__labels' }, this.title, this.sub), this.timer, h('div', { class: 'turn__bar' }, this.timerFill));
    this.element = h('section', { class: 'turn' }, this.banner, this.opponent, this.hand, this.description, this.controls);
  }

  update(view: MatchView): void {
    this.view = view;
    const key = `${view.turn}:${view.phase}`;
    if (key !== this.turnKey) {
      this.turnKey = key;
      if (view.phase === 'planning') this.selected = null;
    }
    if (this.selected && !view.hand.some(c => c.instanceId === this.selected)) this.selected = null;

    const attacking = view.attackingSide === view.you;
    const planning = view.phase === 'planning';
    const locked = view.selection.locked;
    const turnInHalf = view.half === 1 ? view.turn : view.turn - view.turnsPerHalf;
    const from = view.minute;

    this.banner.className = `turn__banner turn__banner--${planning ? (attacking ? 'attack' : 'defend') : 'live'}`;
    setText(this.title, planning ? (attacking ? '⚔️ Your attack' : '🛡️ Defend!') : '▶ Live action');
    setText(this.sub, `Turn ${turnInHalf}/${view.turnsPerHalf} · ${from}'–${from + view.rules.minutesPerTurn}'`);

    const opponent = view.teams[otherSide(view.you)];
    const opponentName = opponent.manager?.name ?? 'Opponent';
    render(this.opponent,
      h('span', null, opponent.manager?.isBot ? '🤖 ' : '', opponentName, ': ',
        planning ? (opponent.locked ? h('b', { class: 'ok' }, 'locked in ✓') : h('b', { class: 'thinking' }, 'thinking…')) : 'watching'),
      h('span', { class: 'turn__backs' }, Array.from({ length: opponent.handCount }, () => cardBack())),
    );

    this.renderHand(view, attacking, planning, locked, turnInHalf);
    this.renderControls(view, planning, locked);
  }

  /** Called several times per second to animate the countdown. */
  tick(serverNow: number): void {
    const view = this.view;
    if (!view || view.phaseEndsAt === null) return;
    const total = view.phase === 'planning' ? view.rules.planningSeconds * 1000 : (view.lastAction?.durationMs ?? 1) + view.rules.resolutionBufferMs;
    const remaining = Math.max(0, view.phaseEndsAt - serverNow);
    setText(this.timer, view.phase === 'planning' ? String(Math.ceil(remaining / 1000)) : '');
    this.timerFill.style.width = `${Math.min(100, (remaining / total) * 100)}%`;
    this.banner.classList.toggle('turn__banner--hurry', view.phase === 'planning' && !view.selection.locked && remaining < 5000);
  }

  private renderHand(view: MatchView, attacking: boolean, planning: boolean, locked: boolean, turnInHalf: number): void {
    if (view.hand.length === 0) {
      const nextDraw = turnInHalf < 3 ? 3 : turnInHalf + (turnInHalf % 2 === 0 ? 1 : 2);
      render(this.hand, h('p', { class: 'hand__empty' }, nextDraw <= view.turnsPerHalf ? `No cards. You draw one on turn ${nextDraw}.` : 'No cards. Hands refill at half-time.'));
      return;
    }
    render(this.hand, view.hand.map(card => {
      const def = CARD_DEFINITIONS[card.cardId];
      const playable = isCardPlayable(card.cardId, attacking);
      const isLocked = locked && view.selection.cardInstanceId === card.instanceId;
      return cardView(def, {
        selected: isLocked || this.selected === card.instanceId,
        disabled: !planning || locked || !playable,
        reason: isLocked ? 'Played' : !playable ? (def.timing === 'attack' ? 'Attack only' : 'Defence only') : undefined,
        onClick: () => {
          if (!planning || locked || !playable) return;
          this.selected = this.selected === card.instanceId ? null : card.instanceId;
          this.update(view);
        },
      });
    }));
  }

  private renderControls(view: MatchView, planning: boolean, locked: boolean): void {
    if (!planning || locked) setText(this.description, '');
    if (!planning) {
      render(this.controls, h('p', { class: 'turn__note' }, 'Watch the action unfold…'));
      return;
    }
    if (locked) {
      const card = view.hand.find(c => c.instanceId === view.selection.cardInstanceId);
      const def = card ? CARD_DEFINITIONS[card.cardId] : null;
      render(this.controls, h('p', { class: 'turn__note turn__note--locked' },
        def ? `🔒 ${def.icon} ${def.name} locked in` : '⏭ Skipped', ' — waiting for the opponent…'));
      return;
    }
    const selected = view.hand.find(c => c.instanceId === this.selected);
    setText(this.description, selected ? CARD_DEFINITIONS[selected.cardId].description : '');
    render(this.controls,
      h('button', { class: 'btn btn--ghost', onClick: () => this.actions.playCard(null) }, 'Skip'),
      h('button', {
        class: 'btn btn--primary btn--grow',
        disabled: !selected,
        onClick: () => { if (this.selected) this.actions.playCard(this.selected); },
      }, selected ? `Play ${CARD_DEFINITIONS[selected.cardId].name}` : 'Pick a card'),
    );
  }
}
