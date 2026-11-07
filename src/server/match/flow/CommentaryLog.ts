import type { CommentaryLine, CommentaryTone, MatchEvent, Side } from '../../../shared/model/match';

const MAX_LINES = 80;

export class CommentaryLog {
  private lines: CommentaryLine[] = [];
  private nextId = 1;

  add(line: Omit<CommentaryLine, 'id'>): void {
    this.lines.push({ ...line, id: this.nextId++ });
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
  }

  info(minute: number, text: string, side: Side | null = null): void {
    this.add({ actionId: null, eventIndex: null, minute, text, side, tone: 'info' });
  }

  addActionEvents(actionId: number, minute: number, events: readonly MatchEvent[]): void {
    events.forEach((event, eventIndex) => {
      this.add({ actionId, eventIndex, minute, text: event.text, side: event.side, tone: toneOf(event) });
    });
  }

  all(): readonly CommentaryLine[] {
    return this.lines;
  }
}

function toneOf(event: MatchEvent): CommentaryTone {
  if (event.kind === 'goal') return 'goal';
  if (event.booking) return 'card';
  if (event.kind === 'cards' || event.kind === 'counter') return 'info';
  const chanceKinds: MatchEvent['kind'][] = ['shot', 'header', 'save', 'miss', 'block', 'through_ball', 'penalty', 'free_kick', 'corner', 'dive', 'offside'];
  return chanceKinds.includes(event.kind) ? 'chance' : 'neutral';
}
