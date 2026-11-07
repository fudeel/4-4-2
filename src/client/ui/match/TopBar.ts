import { CARD_DEFINITIONS } from '../../../shared/model/cards';
import type { MatchView, Side } from '../../../shared/model/match';
import { h, render, setText } from '../dom';

export interface TopBarModel {
  view: MatchView;
  score: Record<Side, number>;
  /** Minute of the action being shown, if any. */
  liveMinute: number | null;
}

/** Scoreboard, clock, momentum and active effects. */
export class TopBar {
  readonly element: HTMLElement;
  private readonly homeName = h('span', { class: 'sb__name' });
  private readonly awayName = h('span', { class: 'sb__name' });
  private readonly homeCrest = h('i', { class: 'sb__crest' });
  private readonly awayCrest = h('i', { class: 'sb__crest' });
  private readonly score = h('span', { class: 'sb__score' });
  private readonly clock = h('span', { class: 'sb__clock' });
  private readonly momentumFill = h('i', { class: 'momentum__fill' });
  private readonly effects = h('div', { class: 'effects' });
  private lastScoreText = '';

  constructor() {
    this.element = h('div', { class: 'topbar' },
      h('div', { class: 'sb' },
        h('div', { class: 'sb__team sb__team--home' }, this.homeCrest, this.homeName),
        h('div', { class: 'sb__center' }, this.score, this.clock),
        h('div', { class: 'sb__team sb__team--away' }, this.awayName, this.awayCrest),
      ),
      h('div', { class: 'momentum', title: 'Momentum' }, h('span', { class: 'momentum__mid' }), this.momentumFill),
      this.effects,
    );
  }

  update({ view, score, liveMinute }: TopBarModel): void {
    const { home, away } = view.teams;
    setText(this.homeName, home.team.shortName + (view.you === 'home' ? ' •' : ''));
    setText(this.awayName, (view.you === 'away' ? '• ' : '') + away.team.shortName);
    this.homeCrest.style.background = home.team.primaryColor;
    this.awayCrest.style.background = away.team.primaryColor;

    const scoreText = `${score.home} – ${score.away}`;
    if (scoreText !== this.lastScoreText) {
      if (this.lastScoreText) {
        this.score.classList.remove('sb__score--bump');
        void this.score.offsetWidth; // restart the animation
        this.score.classList.add('sb__score--bump');
      }
      this.lastScoreText = scoreText;
      setText(this.score, scoreText);
    }

    setText(this.clock, this.clockText(view, liveMinute));

    const m = Math.max(-100, Math.min(100, view.momentum));
    const width = Math.abs(m) / 2;
    this.momentumFill.style.width = `${width}%`;
    this.momentumFill.style.left = m >= 0 ? `${50 - width}%` : '50%';
    this.momentumFill.style.background = m >= 0 ? home.team.primaryColor : away.team.primaryColor;

    const chips = view.activeEffects.map(effect => h('span', {
      class: 'effect-chip',
      style: { borderColor: view.teams[effect.owner].team.primaryColor },
    }, `${CARD_DEFINITIONS[effect.cardId].icon} ${effect.label} · ${effect.remainingTurns}`));
    if (view.counterAttack && view.phase === 'planning') {
      chips.push(h('span', { class: 'effect-chip effect-chip--counter', style: { borderColor: view.teams[view.counterAttack].team.primaryColor } }, `⚡ Counter-attack · ${view.teams[view.counterAttack].team.shortName}`));
    }
    render(this.effects, chips);
  }

  private clockText(view: MatchView, liveMinute: number | null): string {
    if (view.phase === 'halftime') return 'HALF-TIME';
    if (view.phase === 'fulltime') return 'FULL-TIME';
    const minute = liveMinute ?? view.minute;
    return `${minute}' · ${view.half === 1 ? '1st' : '2nd'} half`;
  }
}
