import type { CommentaryLine, MatchView } from '../../../shared/model/match';
import { h, render } from '../dom';

/** The last few commentary lines, newest at the bottom. Tapping opens the full log. */
export class CommentaryTicker {
  readonly element: HTMLElement;
  private lastKey = '';

  constructor(onOpen: () => void) {
    this.element = h('button', { class: 'ticker', 'aria-label': 'Open match commentary', onClick: onOpen });
  }

  update(view: MatchView, lines: readonly CommentaryLine[]): void {
    const recent = lines.slice(-3);
    const key = recent.map(l => l.id).join(',');
    if (key === this.lastKey) return;
    this.lastKey = key;
    render(this.element, recent.map((line, i) => commentaryLine(view, line, i === recent.length - 1 ? 'ticker__line ticker__line--new' : 'ticker__line')));
  }
}

export function commentaryLine(view: MatchView, line: CommentaryLine, className: string): HTMLElement {
  const color = line.side ? view.teams[line.side].team.primaryColor : 'transparent';
  return h('p', { class: `${className} tone--${line.tone}`, style: { borderLeftColor: color } },
    h('span', { class: 'ticker__minute' }, `${line.minute}'`),
    line.text,
  );
}
