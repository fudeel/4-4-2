import type { CardId } from '../../../shared/model/cards';
import type { ActiveEffectView, Side } from '../../../shared/model/match';
import type { ActionModifier } from '../engine/modifiers';

/** An effect that outlives the turn it was played in (e.g. Siege, Team Talk). */
export interface ActiveEffect {
  readonly id: string;
  readonly cardId: CardId;
  readonly owner: Side;
  readonly label: string;
  /** Turns left, not counting the turn the card was played in. */
  remainingTurns: number;
  readonly createdTurn: number;
  /** Forces this side to attack while the effect lasts. */
  readonly forcedAttacker?: Side;
  /** Extra energy drained from the owner's players each turn. */
  readonly extraFatigue?: number;
  modifiers(): ActionModifier[];
}

export class ActiveEffectList {
  private effects: ActiveEffect[] = [];

  add(effect: ActiveEffect): void {
    this.effects.push(effect);
  }

  all(): readonly ActiveEffect[] {
    return this.effects;
  }

  /** Modifiers of effects carried over from earlier turns. */
  carriedModifiers(currentTurn: number): ActionModifier[] {
    return this.effects.filter(e => e.createdTurn < currentTurn).flatMap(e => e.modifiers());
  }

  forcedAttacker(): Side | null {
    return this.effects.find(e => e.forcedAttacker && e.remainingTurns > 0)?.forcedAttacker ?? null;
  }

  extraFatigue(side: Side): number {
    return this.effects.filter(e => e.owner === side).reduce((sum, e) => sum + (e.extraFatigue ?? 0), 0);
  }

  /** Called after each turn: effects created before this turn lose one turn. */
  tick(currentTurn: number): void {
    for (const effect of this.effects) {
      if (effect.createdTurn < currentTurn) effect.remainingTurns -= 1;
    }
    this.effects = this.effects.filter(e => e.remainingTurns > 0);
  }

  clear(): void {
    this.effects = [];
  }

  toView(): ActiveEffectView[] {
    return this.effects.map(e => ({
      id: e.id, cardId: e.cardId, owner: e.owner, label: e.label, remainingTurns: e.remainingTurns,
    }));
  }
}
