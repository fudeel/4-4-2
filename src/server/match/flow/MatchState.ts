import type { ActionReport, MatchPhase, Side } from '../../../shared/model/match';
import { totalTurns, turnsPerHalf, type MatchRules } from '../../../shared/rules';
import { ActiveEffectList } from '../effects/ActiveEffects';
import type { TeamState } from '../model/TeamState';
import { CommentaryLog } from './CommentaryLog';
import { MomentumMeter, PossessionScheduler } from './MatchDynamics';

export interface GoalRecord {
  playerId: string;
  side: Side;
  minute: number;
}

/** All mutable data of a match. Behaviour lives in `Match` and `TurnResolver`. */
export class MatchState {
  phase: MatchPhase = 'lobby';
  phaseEndsAt: number | null = null;
  /** 0 before kick-off, then 1…totalTurns. */
  turn = 0;
  attackingSide: Side | null = null;
  counterAttack: Side | null = null;
  score: Record<Side, number> = { home: 0, away: 0 };
  lastAction: ActionReport | null = null;
  actionCounter = 0;
  goals: GoalRecord[] = [];
  rematch: Record<Side, boolean> = { home: false, away: false };

  readonly momentum = new MomentumMeter();
  readonly effects = new ActiveEffectList();
  readonly possession = new PossessionScheduler();
  readonly commentary = new CommentaryLog();

  constructor(
    readonly roomCode: string,
    readonly rules: MatchRules,
    readonly teams: Record<Side, TeamState>,
  ) {}

  get turnsPerHalf(): number {
    return turnsPerHalf(this.rules);
  }

  get totalTurns(): number {
    return totalTurns(this.rules);
  }

  get half(): 1 | 2 {
    return this.turn > this.turnsPerHalf ? 2 : 1;
  }

  get turnInHalf(): number {
    return this.half === 1 ? this.turn : this.turn - this.turnsPerHalf;
  }

  /** In-game minute when the current turn starts. */
  get minute(): number {
    return Math.max(0, this.turn - 1) * this.rules.minutesPerTurn;
  }

  team(side: Side): TeamState {
    return this.teams[side];
  }
}
