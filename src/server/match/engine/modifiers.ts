import type { RollStage, Side } from '../../../shared/model/match';
import type { MatchPlayer } from '../model/MatchPlayer';
import type { ActionContext } from './ActionContext';

export type PhaseKind = 'buildup' | 'chance' | 'shot' | 'penalty' | 'free_kick' | 'corner';

/**
 * Hooks through which cards, effects and situational bonuses influence an action.
 * Every hook is optional, so each modifier only implements what it changes (ISP),
 * and new cards never require touching the engine (OCP).
 */
export interface ActionModifier {
  readonly owner: Side;
  /** Lower runs first when several modifiers intercept the same phase. */
  readonly priority?: number;
  /** Multiplier on a whole team's strength at a stage. */
  teamMultiplier?(stage: RollStage, side: Side): number;
  /** Multiplier on a single player's contribution at a stage. */
  playerMultiplier?(player: MatchPlayer, stage: RollStage, side: Side): number;
  /** Additive change to `side`'s success probability at a stage. */
  probabilityBonus?(stage: RollStage, side: Side): number;
  /** Additive change to the quality (0–1) of a created chance. */
  chanceQualityBonus?(ctx: ActionContext): number;
  /**
   * Takes over a phase before it is played.
   * Return the next phase to play, `null` to end the action, or `undefined` to let the phase run normally.
   */
  intercept?(phase: PhaseKind, ctx: ActionContext): PhaseKind | null | undefined;
  /** Picks the shooter instead of the default selection. */
  chooseShooter?(ctx: ActionContext): MatchPlayer | null;
  /** Called after a contested phase has been resolved. */
  afterPhase?(phase: PhaseKind, attackSucceeded: boolean, ctx: ActionContext): void;
  /** Multiplier on how often `side` commits fouls while defending. */
  foulMultiplier?(side: Side): number;
  /** Added to the yellow-card chance of every foul committed by `side`. */
  bookingBonus?(side: Side): number;
  /** Chance that `side` concedes a counter-attack when it loses the ball. */
  counterExposure?(side: Side): number;
}

export class ModifierStack {
  private readonly modifiers: ActionModifier[];

  constructor(modifiers: readonly ActionModifier[] = []) {
    this.modifiers = [...modifiers].sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
  }

  teamMultiplier(stage: RollStage, side: Side): number {
    return this.modifiers.reduce((acc, m) => acc * (m.teamMultiplier?.(stage, side) ?? 1), 1);
  }

  playerMultiplier(player: MatchPlayer, stage: RollStage, side: Side): number {
    return this.modifiers.reduce((acc, m) => acc * (m.playerMultiplier?.(player, stage, side) ?? 1), 1);
  }

  probabilityBonus(stage: RollStage, side: Side): number {
    return this.modifiers.reduce((acc, m) => acc + (m.probabilityBonus?.(stage, side) ?? 0), 0);
  }

  chanceQualityBonus(ctx: ActionContext): number {
    return this.modifiers.reduce((acc, m) => acc + (m.chanceQualityBonus?.(ctx) ?? 0), 0);
  }

  intercept(phase: PhaseKind, ctx: ActionContext): PhaseKind | null | undefined {
    for (const modifier of this.modifiers) {
      const next = modifier.intercept?.(phase, ctx);
      if (next !== undefined) return next;
    }
    return undefined;
  }

  chooseShooter(ctx: ActionContext): MatchPlayer | null {
    for (const modifier of this.modifiers) {
      const shooter = modifier.chooseShooter?.(ctx);
      if (shooter) return shooter;
    }
    return null;
  }

  afterPhase(phase: PhaseKind, attackSucceeded: boolean, ctx: ActionContext): void {
    for (const modifier of this.modifiers) modifier.afterPhase?.(phase, attackSucceeded, ctx);
  }

  foulMultiplier(side: Side): number {
    return this.modifiers.reduce((acc, m) => acc * (m.foulMultiplier?.(side) ?? 1), 1);
  }

  bookingBonus(side: Side): number {
    return this.modifiers.reduce((acc, m) => acc + (m.bookingBonus?.(side) ?? 0), 0);
  }

  counterExposure(side: Side): number {
    return this.modifiers.reduce((acc, m) => acc + (m.counterExposure?.(side) ?? 0), 0);
  }
}
