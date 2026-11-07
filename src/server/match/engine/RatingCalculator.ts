import type { RollStage, Side } from '../../../shared/model/match';
import { weightedAttributes, type AttributeKey, type Position, type TraitId } from '../../../shared/model/player';
import type { FieldPlayer, TeamState } from '../model/TeamState';
import type { ModifierStack } from './modifiers';

export type AttributeWeights = Partial<Record<AttributeKey, number>>;

/** How a team's strength is measured in one contest: which roles matter and which attributes. */
export interface StrengthProfile {
  roleWeights: Partial<Record<Position, number>>;
  attributes: AttributeWeights;
}

export const PROFILES = {
  buildUpAttack: {
    roleWeights: { GK: 0.15, DEF: 0.5, MID: 1, FWD: 0.35 },
    attributes: { passing: 0.45, dribbling: 0.3, pace: 0.15, physical: 0.1 },
  },
  buildUpDefense: {
    roleWeights: { DEF: 0.5, MID: 1, FWD: 0.45 },
    attributes: { defending: 0.45, physical: 0.25, pace: 0.2, passing: 0.1 },
  },
  chanceAttack: {
    roleWeights: { DEF: 0.2, MID: 0.6, FWD: 1 },
    attributes: { passing: 0.3, dribbling: 0.3, pace: 0.25, physical: 0.15 },
  },
  chanceDefense: {
    roleWeights: { GK: 0.2, DEF: 1, MID: 0.5, FWD: 0.1 },
    attributes: { defending: 0.55, physical: 0.25, pace: 0.2 },
  },
} satisfies Record<string, StrengthProfile>;

export const SKILLS = {
  shooting: { shooting: 0.8, dribbling: 0.1, physical: 0.1 },
  heading: { physical: 0.55, shooting: 0.35, pace: 0.1 },
  aerialDuel: { physical: 0.7, pace: 0.15, defending: 0.15 },
  goalkeeping: { goalkeeping: 0.85, physical: 0.1, pace: 0.05 },
  blocking: { defending: 0.6, physical: 0.25, pace: 0.15 },
  passing: { passing: 0.7, dribbling: 0.3 },
  pressing: { defending: 0.6, pace: 0.25, physical: 0.15 },
} satisfies Record<string, AttributeWeights>;

type TraitRule = { stages: RollStage[]; when: 'attack' | 'defense' | 'any'; multiplier: number };

const TRAIT_RULES: Partial<Record<TraitId, TraitRule>> = {
  clinical: { stages: ['shot', 'penalty', 'free_kick'], when: 'attack', multiplier: 1.1 },
  playmaker: { stages: ['buildup', 'chance'], when: 'attack', multiplier: 1.1 },
  speedster: { stages: ['chance'], when: 'attack', multiplier: 1.1 },
  wall: { stages: ['chance', 'block'], when: 'defense', multiplier: 1.1 },
  reflexes: { stages: ['shot', 'penalty', 'free_kick', 'aerial'], when: 'defense', multiplier: 1.1 },
  hothead: { stages: ['buildup'], when: 'defense', multiplier: 1.1 },
  aerial: { stages: ['aerial'], when: 'any', multiplier: 1.2 },
};

/** Momentum swings ratings by at most ±6%. */
const MOMENTUM_IMPACT = 0.06;

/** Turns player attributes, traits, fatigue and modifiers into comparable strength numbers. */
export class RatingCalculator {
  constructor(
    private readonly modifiers: ModifierStack,
    private readonly momentumFor: (side: Side) => number,
    private readonly attackingSide: Side,
  ) {}

  /** A single player's score (≈ 1–99) for a skill at a stage. */
  playerScore(fp: FieldPlayer, side: Side, attributes: AttributeWeights, stage: RollStage): number {
    const base = weightedAttributes(fp.player.effectiveAttributes(fp.role), attributes);
    return base * this.traitMultiplier(fp, side, stage) * this.modifiers.playerMultiplier(fp.player, stage, side);
  }

  /** Strength of a whole team in a contest. */
  teamStrength(team: TeamState, profile: StrengthProfile, stage: RollStage): number {
    let total = 0;
    for (const fp of team.onPitch()) {
      const weight = profile.roleWeights[fp.role] ?? 0;
      if (weight > 0) total += weight * this.playerScore(fp, team.side, profile.attributes, stage);
    }
    return total * this.modifiers.teamMultiplier(stage, team.side) * this.momentumMultiplier(team.side);
  }

  momentumMultiplier(side: Side): number {
    return 1 + MOMENTUM_IMPACT * (this.momentumFor(side) / 100);
  }

  /**
   * Converts two strengths into a success probability for the first one.
   * `base` is the probability when both sides are equal, `slope` how much the difference matters.
   */
  contest(attack: number, defense: number, base: number, slope: number, min: number, max: number): number {
    const total = attack + defense;
    const edge = total <= 0 ? 0 : (attack - defense) / total;
    return clamp(base + slope * edge, min, max);
  }

  private traitMultiplier(fp: FieldPlayer, side: Side, stage: RollStage): number {
    const trait = fp.player.profile.trait;
    const rule = trait ? TRAIT_RULES[trait] : undefined;
    if (!rule || !rule.stages.includes(stage)) return 1;
    const isAttacking = side === this.attackingSide;
    if (rule.when === 'attack' && !isAttacking) return 1;
    if (rule.when === 'defense' && isAttacking) return 1;
    return rule.multiplier;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
