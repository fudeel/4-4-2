import type { ActionReport, MatchEvent } from '../../shared/model/match';

export interface PlaybackListener {
  onStart(report: ActionReport, offsetMs: number): void;
  /** `instant` events were skipped (e.g. after a reconnect) and should update state without animation. */
  onEvent(event: MatchEvent, index: number, report: ActionReport, instant: boolean, remainingMs: number): void;
  onComplete(report: ActionReport): void;
}

/** Replays an action's events on the same timeline the server used, so both browsers stay in step. */
export class ActionPlayback {
  private timers: number[] = [];
  private report: ActionReport | null = null;
  private played = -1;

  constructor(private readonly listener: PlaybackListener) {}

  get current(): ActionReport | null {
    return this.report;
  }

  get playedIndex(): number {
    return this.played;
  }

  get isPlaying(): boolean {
    return this.report !== null;
  }

  play(report: ActionReport, offsetMs: number): void {
    this.cancel();
    this.report = report;
    this.played = -1;
    offsetMs = Math.max(0, Math.min(offsetMs, report.durationMs));
    this.listener.onStart(report, offsetMs);

    let at = 0;
    report.events.forEach((event, index) => {
      const delay = at - offsetMs;
      // Catch up completed events silently; keep the active overlay for only the
      // time remaining. Even a fresh report normally arrives a few milliseconds late.
      if (at + event.durationMs <= offsetMs) this.fire(event, index, true, 0);
      else if (delay <= 0) this.fire(event, index, false, event.durationMs + delay);
      else this.timers.push(window.setTimeout(() => this.fire(event, index, false), delay));
      at += event.durationMs;
    });
    this.timers.push(window.setTimeout(() => this.complete(), Math.max(0, at - offsetMs)));
  }

  /** Jumps to the end immediately (e.g. the server already moved on). */
  finish(): void {
    const report = this.report;
    if (!report) return;
    this.clearTimers();
    for (let i = this.played + 1; i < report.events.length; i++) this.fire(report.events[i]!, i, true);
    this.complete();
  }

  cancel(): void {
    this.clearTimers();
    this.report = null;
    this.played = -1;
  }

  private fire(event: MatchEvent, index: number, instant: boolean, remainingMs = event.durationMs): void {
    if (!this.report) return;
    this.played = Math.max(this.played, index);
    this.listener.onEvent(event, index, this.report, instant, remainingMs);
  }

  private complete(): void {
    const report = this.report;
    if (!report) return;
    this.clearTimers();
    this.report = null;
    this.listener.onComplete(report);
  }

  private clearTimers(): void {
    this.timers.forEach(t => window.clearTimeout(t));
    this.timers = [];
  }
}
