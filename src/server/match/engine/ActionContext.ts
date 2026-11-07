import type {
  ActionOutcome,
  DiceRoll,
  MatchEvent,
  MatchEventKind,
  RollStage,
  Side,
} from '../../../shared/model/match';
import type { Position } from '../../../shared/model/player';
import type { Rng } from '../../core/Random';
import type { MatchPlayer } from '../model/MatchPlayer';
import type { FieldPlayer, TeamState } from '../model/TeamState';
import { CommentaryWriter } from './CommentaryWriter';
import type { ModifierStack } from './modifiers';
import { RatingCalculator, clamp, type AttributeWeights } from './RatingCalculator';

const EVENT_DURATION_MS: Record<MatchEventKind, number> = {
  cards: 1700, kickoff: 1200, buildup: 1100, pass: 1000, dribble: 1100, tackle: 1000,
  interception: 900, long_ball: 1300, through_ball: 1100, clearance: 1000, foul: 1500,
  offside: 1500, shot: 800, block: 1000, save: 1300, miss: 1200, goal: 3200, corner: 1400,
  header: 900, penalty: 1700, free_kick: 1500, dive: 1500, counter: 1100, whistle: 1500,
};

export interface ActionSetup {
  attack: TeamState;
  defense: TeamState;
  modifiers: ModifierStack;
  rng: Rng;
  minute: number;
  /** Momentum from a side's own perspective (−100…100). */
  momentumFor: (side: Side) => number;
}

export type EventDraft = Omit<MatchEvent, 'durationMs'> & { durationMs?: number };

/** Mutable state of one action (one turn) while it is being resolved. */
export class ActionContext {
  readonly attack: TeamState;
  readonly defense: TeamState;
  readonly modifiers: ModifierStack;
  readonly rng: Rng;
  readonly minute: number;
  readonly ratings: RatingCalculator;
  readonly commentary: CommentaryWriter;

  readonly events: MatchEvent[] = [];
  readonly involved = new Set<string>();
  readonly flags = { longBall: false, oneOnOne: false };

  carrier: MatchPlayer | null = null;
  creator: MatchPlayer | null = null;
  shooter: MatchPlayer | null = null;
  chanceQuality = 0.5;
  outcome: ActionOutcome = 'defended';
  goal: { scorer: MatchPlayer; assister: MatchPlayer | null } | null = null;
  /** Positive values swing momentum towards the attacking side. */
  momentumShift = 0;
  counterAttack = false;
  cornersTaken = 0;
  xg = 0;

  constructor(setup: ActionSetup) {
    this.attack = setup.attack;
    this.defense = setup.defense;
    this.modifiers = setup.modifiers;
    this.rng = setup.rng;
    this.minute = setup.minute;
    this.ratings = new RatingCalculator(setup.modifiers, setup.momentumFor, setup.attack.side);
    this.commentary = new CommentaryWriter(setup.rng);
  }

  get attackSide(): Side {
    return this.attack.side;
  }

  get defenseSide(): Side {
    return this.defense.side;
  }

  emit(draft: EventDraft): MatchEvent {
    const event: MatchEvent = { ...draft, durationMs: draft.durationMs ?? EVENT_DURATION_MS[draft.kind] };
    this.events.push(event);
    if (draft.actorId) this.involved.add(draft.actorId);
    if (draft.targetId) this.involved.add(draft.targetId);
    return event;
  }

  /** Rolls a die for `side` with the given success probability (bonuses from modifiers included). */
  roll(stage: RollStage, label: string, chance: number, side: Side): DiceRoll {
    const adjusted = this.adjustedChance(stage, chance, side);
    const roll = this.rng.next();
    return { stage, label, chance: adjusted, roll, success: roll < adjusted, side };
  }

  /** A base probability after the probability bonuses of both sides' modifiers. */
  adjustedChance(stage: RollStage, chance: number, side: Side): number {
    const opponent = side === this.attackSide ? this.defenseSide : this.attackSide;
    return clamp(
      chance + this.modifiers.probabilityBonus(stage, side) - this.modifiers.probabilityBonus(stage, opponent),
      0.02,
      0.98,
    );
  }

  /** Picks an on-pitch player, weighted by role and by how good they are at the given skill. */
  pick(
    team: TeamState,
    roleWeights: Partial<Record<Position, number>>,
    skill: AttributeWeights,
    exclude: readonly (MatchPlayer | null)[] = [],
  ): FieldPlayer | null {
    const candidates = team
      .onPitch()
      .filter(fp => (roleWeights[fp.role] ?? 0) > 0 && !exclude.some(p => p?.id === fp.player.id));
    if (candidates.length === 0) return null;
    return this.rng.weighted(candidates, fp => {
      const score = this.ratings.playerScore(fp, team.side, skill, 'special');
      return (roleWeights[fp.role] ?? 0) * Math.pow(Math.max(score, 1), 1.5);
    });
  }

  /** The best on-pitch player of a team at a skill. */
  best(team: TeamState, skill: AttributeWeights, roles: Position[] = ['DEF', 'MID', 'FWD']): FieldPlayer | null {
    const candidates = team.inRoles(...roles);
    if (candidates.length === 0) return null;
    return candidates.reduce((best, fp) =>
      this.ratings.playerScore(fp, team.side, skill, 'special') > this.ratings.playerScore(best, team.side, skill, 'special') ? fp : best,
    );
  }

  fieldPlayerOf(player: MatchPlayer): FieldPlayer | undefined {
    return this.attack.fieldPlayer(player.id) ?? this.defense.fieldPlayer(player.id);
  }

  teamOf(player: MatchPlayer): TeamState {
    return this.attack.players.has(player.id) ? this.attack : this.defense;
  }

  /**
   * Referee decision after a foul. Returns the booking, if any, and applies it
   * (a second yellow or a straight red sends the player off).
   */
  book(player: MatchPlayer, options: { yellowChance: number; forceYellow?: boolean }): { playerId: string; card: 'yellow' | 'red' } | undefined {
    const team = this.teamOf(player);
    const straightRed = !options.forceYellow && this.rng.chance(0.02);
    const hothead = player.hasTrait('hothead') ? 0.15 : 0;
    const yellow = options.forceYellow || this.rng.chance(options.yellowChance + hothead);
    if (!straightRed && !yellow) return undefined;

    if (!straightRed) {
      player.yellowCards += 1;
      team.stats.yellowCards += 1;
      player.adjustRating(-0.4);
    }
    if (straightRed || player.yellowCards >= 2) {
      team.stats.redCards += 1;
      player.adjustRating(-1.5);
      team.sendOff(player.id);
      return { playerId: player.id, card: 'red' };
    }
    return { playerId: player.id, card: 'yellow' };
  }

  scoreGoal(scorer: MatchPlayer, assister: MatchPlayer | null): void {
    this.goal = { scorer, assister };
    this.outcome = 'goal';
    scorer.goals += 1;
    scorer.adjustRating(1.1);
    if (assister && assister !== scorer) {
      assister.assists += 1;
      assister.adjustRating(0.6);
    }
    const keeper = this.defense.goalkeeper();
    keeper?.player.adjustRating(-0.35);
    this.momentumShift += 25;
  }
}
