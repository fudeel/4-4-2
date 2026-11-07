export interface Clock {
  now(): number;
}

export interface TimerHandle {
  cancel(): void;
}

/** Abstracts timers so the match state machine can run in real time or be fast-forwarded in tests. */
export interface Scheduler extends Clock {
  schedule(delayMs: number, task: () => void): TimerHandle;
}

export class SystemScheduler implements Scheduler {
  now(): number {
    return Date.now();
  }

  schedule(delayMs: number, task: () => void): TimerHandle {
    const id = setTimeout(task, Math.max(0, delayMs));
    return { cancel: () => clearTimeout(id) };
  }
}

/** Deterministic scheduler for tests and simulations: time only moves when `advance` is called. */
export class ManualScheduler implements Scheduler {
  private time = 0;
  private sequence = 0;
  private tasks: { at: number; seq: number; task: () => void; cancelled: boolean }[] = [];

  now(): number {
    return this.time;
  }

  schedule(delayMs: number, task: () => void): TimerHandle {
    const entry = { at: this.time + Math.max(0, delayMs), seq: this.sequence++, task, cancelled: false };
    this.tasks.push(entry);
    return { cancel: () => { entry.cancelled = true; } };
  }

  /** Runs every task due within the next `ms` milliseconds, in order. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      this.tasks = this.tasks.filter(t => !t.cancelled);
      const due = this.tasks.filter(t => t.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      this.tasks.splice(this.tasks.indexOf(due), 1);
      this.time = due.at;
      due.task();
    }
    this.time = target;
  }

  /** Runs tasks until none are left (or the safety limit is hit). */
  runAll(limitMs = 24 * 60 * 60 * 1000): void {
    const end = this.time + limitMs;
    while (this.time < end) {
      this.tasks = this.tasks.filter(t => !t.cancelled);
      const next = this.tasks.sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!next) return;
      this.advance(next.at - this.time);
    }
  }
}
