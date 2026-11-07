import { LineupBuilder } from '../../../shared/model/lineup';
import { otherSide, type CommentaryLine, type MatchView, type Side, type TeamMatchStats, type TeamView } from '../../../shared/model/match';
import { TRAITS } from '../../../shared/model/player';
import type { GameActions } from '../../state/GameStore';
import { LineupEditor } from '../components/LineupEditor';
import { h, render, setText } from '../dom';
import { energyColor, playerById, ratingClass, shortName } from '../format';
import { commentaryLine } from './CommentaryTicker';

/** A bottom sheet over the pitch. */
class Sheet {
  readonly element: HTMLElement;
  protected readonly body = h('div', { class: 'sheet__body' });
  protected readonly heading = h('h2', { class: 'sheet__title' });

  constructor(className: string, closable: boolean) {
    this.element = h('div', { class: `sheet ${className}`, role: 'dialog' },
      h('div', { class: 'sheet__panel' },
        h('header', { class: 'sheet__header' }, this.heading,
          closable ? h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: () => this.close() }, '✕') : null),
        this.body,
      ),
    );
    if (closable) this.element.addEventListener('click', e => { if (e.target === this.element) this.close(); });
  }

  get isOpen(): boolean {
    return this.element.classList.contains('is-open');
  }

  open(): void {
    this.element.classList.add('is-open');
  }

  close(): void {
    this.element.classList.remove('is-open');
  }
}

const STAT_ROWS: [keyof TeamMatchStats, string][] = [
  ['shots', 'Shots'],
  ['shotsOnTarget', 'On target'],
  ['xg', 'Expected goals (xG)'],
  ['chancesCreated', 'Chances created'],
  ['corners', 'Corners'],
  ['fouls', 'Fouls'],
  ['yellowCards', 'Yellow cards'],
  ['redCards', 'Red cards'],
  ['cardsPlayed', 'Tactic cards played'],
];

export function statsTable(view: MatchView): HTMLElement {
  const { home, away } = view.teams;
  return h('div', { class: 'stats' },
    h('div', { class: 'stats__head' },
      h('span', { style: { color: home.team.primaryColor } }, home.team.shortName),
      h('span', null, 'Match stats'),
      h('span', { style: { color: away.team.primaryColor } }, away.team.shortName),
    ),
    STAT_ROWS.map(([key, label]) => {
      const a = home.stats[key];
      const b = away.stats[key];
      const total = a + b || 1;
      return h('div', { class: 'stats__row' },
        h('b', null, String(a)),
        h('div', { class: 'stats__bar' },
          h('span', null, label),
          h('i', { style: { width: `${(a / total) * 100}%`, background: home.team.primaryColor } }),
          h('i', { style: { width: `${(b / total) * 100}%`, background: away.team.primaryColor } }),
        ),
        h('b', null, String(b)),
      );
    }),
  );
}

export class HalfTimeSheet extends Sheet {
  private readonly editor: LineupEditor;
  private readonly timer = h('span', { class: 'sheet__timer' });
  private readonly summary = h('div');
  private readonly status = h('p', { class: 'lobby__status' });
  private readonly readyButton: HTMLButtonElement;
  private ready = false;
  private view: MatchView | null = null;

  constructor(actions: GameActions) {
    super('sheet--halftime', false);
    this.editor = new LineupEditor({ onChange: lineup => actions.setLineup(lineup) });
    this.readyButton = h('button', { class: 'btn btn--primary btn--block', onClick: () => actions.setReady(!this.ready) }, 'Ready for the 2nd half');
    this.heading.append('Half-time ', this.timer);
    render(this.body,
      this.summary,
      h('h3', { class: 'sheet__subtitle' }, 'Tactics & substitutions'),
      this.editor.element,
      h('footer', { class: 'sheet__footer' }, this.status, this.readyButton),
    );
  }

  update(view: MatchView): void {
    this.view = view;
    const mine = view.teams[view.you];
    const theirs = view.teams[otherSide(view.you)];
    this.ready = mine.ready;
    render(this.summary, scoreLine(view), statsTable(view));
    this.editor.update({ team: mine, mode: 'halftime', locked: mine.ready, maxSubstitutions: view.rules.maxSubstitutions });
    setText(this.readyButton, mine.ready ? '✓ Ready — tap to change' : 'Ready for the 2nd half');
    this.readyButton.classList.toggle('btn--done', mine.ready);
    setText(this.status, theirs.ready ? `${theirs.manager?.name ?? 'Opponent'} is ready.` : `${theirs.manager?.name ?? 'Opponent'} is making changes…`);
  }

  tick(serverNow: number): void {
    if (!this.view?.phaseEndsAt) return;
    setText(this.timer, `${Math.max(0, Math.ceil((this.view.phaseEndsAt - serverNow) / 1000))}s`);
  }
}

export class FullTimeSheet extends Sheet {
  private readonly rematchButton: HTMLButtonElement;

  constructor(private readonly actions: GameActions) {
    super('sheet--fulltime', false);
    this.rematchButton = h('button', { class: 'btn btn--primary btn--grow', onClick: () => actions.requestRematch() }, 'Rematch');
  }

  update(view: MatchView): void {
    const result = view.result;
    const outcome = !result?.winner ? 'Draw' : result.winner === view.you ? 'Victory!' : 'Defeat';
    setText(this.heading, `Full-time — ${outcome}`);
    const motm = result?.manOfTheMatch ? playerById(view, result.manOfTheMatch.playerId) : null;
    const opponent = view.teams[otherSide(view.you)];
    const theyWant = view.rematch[otherSide(view.you)];
    const iWant = view.rematch[view.you];
    this.rematchButton.disabled = iWant;
    setText(this.rematchButton, iWant ? 'Waiting for opponent…' : theyWant ? 'Accept rematch' : 'Rematch');

    render(this.body,
      scoreLine(view),
      h('div', { class: 'scorers' },
        (['home', 'away'] as const).map(side => h('div', { class: `scorers__col scorers__col--${side}` },
          (result?.scorers ?? []).filter(g => g.side === side).map(g => {
            const p = playerById(view, g.playerId);
            return h('p', null, `⚽ ${p ? shortName(p.player) : '?'} ${g.minute}'`);
          }),
        )),
      ),
      motm && result?.manOfTheMatch
        ? h('div', { class: 'motm' }, '🏅 Player of the match: ', h('strong', null, motm.player.name), ` (${view.teams[motm.side].team.shortName}) · ${result.manOfTheMatch.rating.toFixed(1)}`)
        : null,
      statsTable(view),
      theyWant && !iWant ? h('p', { class: 'lobby__status' }, `${opponent.manager?.name ?? 'Opponent'} wants a rematch!`) : null,
      h('footer', { class: 'sheet__footer sheet__footer--row' },
        h('button', { class: 'btn btn--ghost', onClick: () => this.actions.leaveRoom() }, 'Leave'),
        this.rematchButton,
      ),
    );
  }
}

export class TeamSheet extends Sheet {
  private side: Side | null = null;

  constructor() {
    super('sheet--team', true);
  }

  update(view: MatchView): void {
    const side = this.side ?? view.you;
    const team = view.teams[side];
    setText(this.heading, team.team.name);
    render(this.body,
      h('div', { class: 'tabs' }, (['home', 'away'] as const).map(s => h('button', {
        class: `chip ${s === side ? 'chip--active' : ''}`,
        onClick: () => { this.side = s; this.update(view); },
      }, view.teams[s].team.shortName + (s === view.you ? ' (you)' : '')))),
      h('p', { class: 'lineup__hint' }, `Formation ${team.lineup.formationId} · Subs used ${team.subsUsed}/${view.rules.maxSubstitutions}`),
      this.rows(team, true),
      h('h3', { class: 'sheet__subtitle' }, 'Bench'),
      this.rows(team, false),
    );
  }

  private rows(team: TeamView, onPitch: boolean): HTMLElement {
    const ids = new Set(LineupBuilder.onPitch(team.lineup));
    const players = team.squad.filter(p => ids.has(p.id) === onPitch);
    return h('div', { class: 'roster' }, players.map(p => {
      const s = team.players[p.id]!;
      return h('div', { class: `roster__row ${s.sentOff || s.subbedOff ? 'roster__row--out' : ''}` },
        h('span', { class: `pos pos--${p.position}` }, p.position),
        h('span', { class: 'roster__name' }, `${p.number} ${shortName(p)}`, p.trait ? ` ${TRAITS[p.trait].icon}` : '',
          s.goals ? ` ${'⚽'.repeat(s.goals)}` : '', s.yellowCards ? ' 🟨' : '', s.sentOff ? ' 🟥' : ''),
        h('span', { class: 'roster__energy' }, h('i', { style: { width: `${s.energy}%`, background: energyColor(s.energy) } })),
        h('span', { class: ratingClass(s.rating) }, s.rating.toFixed(1)),
      );
    }));
  }
}

export class CommentarySheet extends Sheet {
  constructor() {
    super('sheet--log', true);
    setText(this.heading, 'Match commentary');
  }

  update(view: MatchView, lines: readonly CommentaryLine[]): void {
    render(this.body, h('div', { class: 'log' }, [...lines].reverse().map(line => commentaryLine(view, line, 'log__line'))));
  }
}

function scoreLine(view: MatchView): HTMLElement {
  const { home, away } = view.teams;
  return h('div', { class: 'scoreline' },
    h('span', { class: 'scoreline__team' }, h('i', { style: { background: home.team.primaryColor } }), home.team.name),
    h('strong', null, `${view.score.home} – ${view.score.away}`),
    h('span', { class: 'scoreline__team' }, away.team.name, h('i', { style: { background: away.team.primaryColor } })),
  );
}
