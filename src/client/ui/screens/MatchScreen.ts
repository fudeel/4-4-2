import type { ActionReport, CommentaryLine, MatchEvent, MatchPhase, MatchView, Side } from '../../../shared/model/match';
import { ActionPlayback } from '../../presentation/ActionPlayback';
import { PitchScene } from '../../render/PitchScene';
import type { ClientState } from '../../state/GameStore';
import { h, setText } from '../dom';
import { CommentaryTicker } from '../match/CommentaryTicker';
import { MatchOverlays } from '../match/MatchOverlays';
import { CommentarySheet, FullTimeSheet, HalfTimeSheet, TeamSheet } from '../match/Sheets';
import { TopBar } from '../match/TopBar';
import { TurnPanel } from '../match/TurnPanel';
import type { Screen, ScreenContext } from './Screen';

/** In-game screen: the 3D pitch with the HUD on top. Mediates between server state, playback and widgets. */
export class MatchScreen implements Screen {
  readonly element: HTMLElement;
  private readonly scene: PitchScene;
  private readonly topBar = new TopBar();
  private readonly ticker: CommentaryTicker;
  private readonly turnPanel: TurnPanel;
  private readonly overlays = new MatchOverlays();
  private readonly halfTime: HalfTimeSheet;
  private readonly fullTime: FullTimeSheet;
  private readonly teamSheet = new TeamSheet();
  private readonly commentarySheet = new CommentarySheet();
  private readonly playback: ActionPlayback;
  private readonly muteButton: HTMLButtonElement;
  private readonly interval: number;
  private view: MatchView | null = null;
  private lastPhase: MatchPhase | null = null;
  private lastActionStarted = 0;
  private goalShown = false;
  private liveMinute: number | null = null;

  constructor(private readonly ctx: ScreenContext) {
    this.scene = new PitchScene(ctx.sfx);
    this.turnPanel = new TurnPanel(ctx.actions);
    this.halfTime = new HalfTimeSheet(ctx.actions);
    this.fullTime = new FullTimeSheet(ctx.actions);
    this.ticker = new CommentaryTicker(() => this.openSheet(this.commentarySheet));
    this.playback = new ActionPlayback({
      onStart: (report, offsetMs) => this.onActionStart(report, offsetMs),
      onEvent: (event, _index, report, instant, remainingMs) => this.onActionEvent(event, report, instant, remainingMs),
      onComplete: () => this.onActionComplete(),
    });
    this.muteButton = h('button', { class: 'icon-btn', 'aria-label': 'Toggle sound', onClick: () => this.toggleMute() }, ctx.sfx.muted ? '🔇' : '🔊');

    this.element = h('main', { class: 'match' },
      this.scene.element,
      h('div', { class: 'hud' },
        h('header', { class: 'hud__top' },
          this.topBar.element,
          h('div', { class: 'hud__tools' },
            h('button', { class: 'icon-btn', 'aria-label': 'Team sheet', onClick: () => this.openSheet(this.teamSheet) }, '👥'),
            this.muteButton,
          ),
        ),
        this.overlays.element,
        h('footer', { class: 'hud__bottom' }, this.ticker.element, this.turnPanel.element),
      ),
      this.halfTime.element,
      this.fullTime.element,
      this.teamSheet.element,
      this.commentarySheet.element,
    );
    this.interval = window.setInterval(() => this.tick(), 200);
  }

  update(state: ClientState): void {
    const view = state.view;
    if (!view) return;
    this.view = view;
    // Finish the old presentation before applying the next phase/lineup.
    if (view.phase !== 'resolving' && this.playback.isPlaying) this.playback.finish();
    this.scene.sync(view);

    const action = view.lastAction;
    if (view.phase === 'resolving' && action && action.id !== this.lastActionStarted) {
      this.lastActionStarted = action.id;
      const remaining = (view.phaseEndsAt ?? 0) - this.ctx.store.serverNow();
      const elapsed = action.durationMs + view.rules.resolutionBufferMs - remaining;
      this.playback.play(action, Math.max(0, elapsed));
    }
    // Keep showing the action's minute until the next turn begins.
    if (view.phase !== 'resolving') this.liveMinute = null;

    this.onPhaseChange(view.phase);
    this.render();
  }

  destroy(): void {
    window.clearInterval(this.interval);
    this.playback.cancel();
    this.scene.destroy();
  }

  // ── Playback callbacks ─────────────────────────────────────────────────────

  private onActionStart(report: ActionReport, offsetMs: number): void {
    this.goalShown = false;
    this.liveMinute = null;
    this.scene.beginAction(report, offsetMs);
  }

  private onActionEvent(event: MatchEvent, report: ActionReport, instant: boolean, remainingMs: number): void {
    if (event.kind !== 'cards') this.liveMinute = report.minute;
    if (event.kind === 'goal') this.goalShown = true;
    if (!instant && this.view) {
      if (event.kind === 'cards') this.overlays.showReveal(report, this.view, remainingMs);
      if (event.roll) this.overlays.showRoll(event.roll, this.view, remainingMs);
      if (event.kind === 'goal') this.overlays.showGoal(event, this.view, remainingMs);
      if (event.kind === 'counter') this.overlays.showBanner('⚡ Counter-attack!', this.view.teams[event.side].team.primaryColor, remainingMs);
      if (event.kind === 'offside') this.overlays.showBanner('🚩 Offside!', '#f2c230', remainingMs);
      if (event.kind === 'penalty') this.overlays.showBanner('⚠️ Penalty!', this.view.teams[event.side].team.primaryColor, remainingMs);
      if (event.booking) this.overlays.showBooking(event, this.view);
    }
    this.render();
  }

  private onActionComplete(): void {
    this.scene.endAction();
    this.render();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private render(): void {
    const view = this.view;
    if (!view) return;
    this.topBar.update({ view, score: this.displayedScore(view), liveMinute: this.liveMinute });
    const lines = this.visibleCommentary(view);
    this.ticker.update(view, lines);
    this.turnPanel.update(view);
    this.element.classList.toggle('match--break', view.phase === 'halftime' || view.phase === 'fulltime');
    this.element.classList.toggle('match--live', view.phase === 'resolving');

    if (view.phase === 'halftime') {
      this.halfTime.update(view);
      this.halfTime.open();
    } else this.halfTime.close();
    if (view.phase === 'fulltime') {
      this.fullTime.update(view);
      this.fullTime.open();
    } else this.fullTime.close();
    if (this.teamSheet.isOpen) this.teamSheet.update(view);
    if (this.commentarySheet.isOpen) this.commentarySheet.update(view, lines);
  }

  private tick(): void {
    const now = this.ctx.store.serverNow();
    this.turnPanel.tick(now);
    this.halfTime.tick(now);
  }

  /** While an action plays, the score only changes when the goal is actually shown. */
  private displayedScore(view: MatchView): Record<Side, number> {
    const current = this.playback.current;
    if (!current) return view.score;
    return this.goalShown ? current.scoreAfter : current.scoreBefore;
  }

  /** Hides commentary for events that haven't been animated yet (no spoilers). */
  private visibleCommentary(view: MatchView): CommentaryLine[] {
    const current = this.playback.current;
    if (!current) return view.commentary;
    return view.commentary.filter(line =>
      line.actionId === null || line.actionId < current.id || (line.actionId === current.id && (line.eventIndex ?? 0) <= this.playback.playedIndex),
    );
  }

  private onPhaseChange(phase: MatchPhase): void {
    if (phase === this.lastPhase) return;
    const previous = this.lastPhase;
    this.lastPhase = phase;
    if (previous === null) return;
    if (phase === 'halftime') this.ctx.sfx.whistle(2);
    if (phase === 'fulltime') this.ctx.sfx.whistle(3);
    if (phase === 'planning' && previous === 'halftime') this.ctx.sfx.whistle(1);
  }

  private openSheet(sheet: TeamSheet | CommentarySheet): void {
    const view = this.view;
    if (!view) return;
    if (sheet instanceof TeamSheet) sheet.update(view);
    else sheet.update(view, this.visibleCommentary(view));
    sheet.open();
  }

  private toggleMute(): void {
    const muted = this.ctx.sfx.toggleMute();
    setText(this.muteButton, muted ? '🔇' : '🔊');
  }
}
