import type { ActionContext } from '../ActionContext';
import type { PhaseKind } from '../modifiers';

/** One step of an attacking move. Returns the next phase, or `null` when the move is over. */
export interface ActionPhase {
  readonly kind: PhaseKind;
  play(ctx: ActionContext): PhaseKind | null;
}
