import type { PlayerMatchState } from '../../../shared/model/match';
import {
  positionFit,
  type AttributeKey,
  type PlayerAttributes,
  type PlayerProfile,
  type Position,
  type TraitId,
} from '../../../shared/model/player';

const MIN_FATIGUE_FACTOR = 0.72;
const BASE_RATING = 6;

/** A player's state for the duration of one match. */
export class MatchPlayer {
  energy = 100;
  yellowCards = 0;
  sentOff = false;
  subbedOff = false;
  /** Took the field at some point in the match. */
  appeared = false;
  goals = 0;
  assists = 0;
  shots = 0;
  saves = 0;
  private matchRating = BASE_RATING;

  constructor(readonly profile: PlayerProfile) {}

  get id(): string {
    return this.profile.id;
  }

  get name(): string {
    return this.profile.name;
  }

  get position(): Position {
    return this.profile.position;
  }

  get rating(): number {
    return this.matchRating;
  }

  hasTrait(trait: TraitId): boolean {
    return this.profile.trait === trait;
  }

  /** 1.0 when fresh, down to 0.72 when exhausted. */
  fatigueFactor(): number {
    return MIN_FATIGUE_FACTOR + (1 - MIN_FATIGUE_FACTOR) * (this.energy / 100);
  }

  /** Attributes after fatigue and position fit, for a player used in `role`. */
  effectiveAttributes(role: Position): PlayerAttributes {
    const factor = this.fatigueFactor() * positionFit(this.position, role);
    const base = this.profile.attributes;
    const result = {} as PlayerAttributes;
    for (const key of Object.keys(base) as AttributeKey[]) {
      result[key] = base[key] * factor;
    }
    return result;
  }

  drain(amount: number): void {
    this.energy = Math.max(0, this.energy - amount);
  }

  recover(amount: number): void {
    this.energy = Math.min(100, this.energy + amount);
  }

  adjustRating(delta: number): void {
    this.matchRating = Math.min(10, Math.max(1, this.matchRating + delta));
  }

  toState(): PlayerMatchState {
    return {
      energy: Math.round(this.energy),
      yellowCards: this.yellowCards,
      sentOff: this.sentOff,
      subbedOff: this.subbedOff,
      goals: this.goals,
      assists: this.assists,
      shots: this.shots,
      saves: this.saves,
      rating: Math.round(this.matchRating * 10) / 10,
    };
  }
}
