import { ActionContext, type ActionSetup } from './ActionContext';
import type { PhaseKind } from './modifiers';
import type { ActionPhase } from './phases/ActionPhase';
import { BuildUpPhase } from './phases/BuildUpPhase';
import { ChanceCreationPhase } from './phases/ChanceCreationPhase';
import { Finisher } from './phases/Finisher';
import { CornerPhase, FreeKickPhase, PenaltyPhase, ShotPhase } from './phases/FinishingPhases';

/** Safety net against phase loops (e.g. a modifier that keeps redirecting). */
const MAX_PHASES = 8;

/**
 * Plays one attacking action (one turn) as a chain of phases.
 * Every contest is a dice roll whose odds come from the players involved.
 */
export class ActionResolver {
  private readonly phases: Map<PhaseKind, ActionPhase>;

  constructor(phases?: ActionPhase[]) {
    const finisher = new Finisher();
    const list = phases ?? [
      new BuildUpPhase(),
      new ChanceCreationPhase(),
      new ShotPhase(finisher),
      new PenaltyPhase(finisher),
      new FreeKickPhase(finisher),
      new CornerPhase(finisher),
    ];
    this.phases = new Map(list.map(p => [p.kind, p]));
  }

  resolve(setup: ActionSetup): ActionContext {
    const ctx = new ActionContext(setup);
    ctx.attack.stats.attacks += 1;
    let next: PhaseKind | null = 'buildup';
    for (let steps = 0; next !== null && steps < MAX_PHASES; steps++) {
      const intercepted = ctx.modifiers.intercept(next, ctx);
      if (intercepted !== undefined) {
        next = intercepted;
        continue;
      }
      const phase = this.phases.get(next);
      if (!phase) throw new Error(`No handler for phase ${next}`);
      next = phase.play(ctx);
    }
    return ctx;
  }
}
