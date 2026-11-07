import type { CardId, CardInstance } from './cards';
import type { Lineup } from './lineup';
import type { PlayerProfile } from './player';
import type { TeamProfile } from './team';
import type { ExhibitionOptions } from './exhibition';

export type Side = 'home' | 'away';
export const SIDES: readonly Side[] = ['home', 'away'];
export const otherSide = (side: Side): Side => (side === 'home' ? 'away' : 'home');

export type MatchPhase = 'lobby' | 'planning' | 'resolving' | 'halftime' | 'fulltime';

export interface PlayerMatchState {
  /** 0–100. Low energy reduces every stat. */
  energy: number;
  yellowCards: number;
  sentOff: boolean;
  subbedOff: boolean;
  goals: number;
  assists: number;
  shots: number;
  saves: number;
  /** Football-Manager-style match rating, 1.0–10.0 (starts at 6.0). */
  rating: number;
}

export interface TeamMatchStats {
  attacks: number;
  chancesCreated: number;
  shots: number;
  shotsOnTarget: number;
  /** Expected goals: sum of the scoring probability of every shot. */
  xg: number;
  fouls: number;
  corners: number;
  yellowCards: number;
  redCards: number;
  cardsPlayed: number;
}

export interface ManagerView {
  name: string;
  isBot: boolean;
  connected: boolean;
}

export interface TeamView {
  side: Side;
  team: TeamProfile;
  squad: PlayerProfile[];
  players: Record<string, PlayerMatchState>;
  lineup: Lineup;
  manager: ManagerView | null;
  ready: boolean;
  /** True once the manager has locked in a card (or a skip) this turn. */
  locked: boolean;
  /** Defence ↔ Attack slider, −100 … +100 (see `shared/model/tactics`). Visible to both managers, like a team's shape. */
  mentality: number;
  handCount: number;
  subsUsed: number;
  stats: TeamMatchStats;
}

export interface ActiveEffectView {
  id: string;
  cardId: CardId;
  owner: Side;
  label: string;
  remainingTurns: number;
}

export interface RevealedCard {
  side: Side;
  cardId: CardId;
  cancelled: boolean;
}

export type RollStage = 'buildup' | 'chance' | 'block' | 'on_target' | 'shot' | 'penalty' | 'free_kick' | 'aerial' | 'special';

/** A transparent dice roll: success when `roll < chance`. */
export interface DiceRoll {
  stage: RollStage;
  label: string;
  /** Probability (0–1) that the acting side succeeds. */
  chance: number;
  roll: number;
  success: boolean;
  /** The side the probability refers to. */
  side: Side;
}

export type MatchEventKind =
  | 'cards'
  | 'kickoff'
  | 'buildup'
  | 'pass'
  | 'dribble'
  | 'tackle'
  | 'interception'
  | 'long_ball'
  | 'through_ball'
  | 'clearance'
  | 'foul'
  | 'offside'
  | 'shot'
  | 'block'
  | 'save'
  | 'miss'
  | 'goal'
  | 'corner'
  | 'header'
  | 'penalty'
  | 'free_kick'
  | 'dive'
  | 'counter'
  | 'whistle';

export type ShotResult = 'goal' | 'saved' | 'missed' | 'blocked';

/** How a chance was made. The engine picks the option that suits the players; the client choreographs each one. */
export type ChanceStyle = 'through' | 'cross' | 'cutback' | 'solo' | 'long_shot';

export interface MatchEvent {
  kind: MatchEventKind;
  /** The side performing the event. */
  side: Side;
  actorId?: string;
  targetId?: string;
  text: string;
  durationMs: number;
  roll?: DiceRoll;
  booking?: { playerId: string; card: 'yellow' | 'red' };
  shotResult?: ShotResult;
  /** Set on the event that creates a chance. */
  style?: ChanceStyle;
}

export type ActionOutcome =
  | 'goal'
  | 'saved'
  | 'missed'
  | 'blocked'
  | 'defended'
  | 'offside'
  | 'foul'
  | 'cleared';

export interface ActionReport {
  id: number;
  turn: number;
  minute: number;
  attackingSide: Side;
  revealed: RevealedCard[];
  events: MatchEvent[];
  outcome: ActionOutcome;
  scoreBefore: Record<Side, number>;
  scoreAfter: Record<Side, number>;
  durationMs: number;
}

export type CommentaryTone = 'neutral' | 'chance' | 'goal' | 'card' | 'info';

export interface CommentaryLine {
  id: number;
  /** The action that produced the line; the client hides it until that event has been animated. */
  actionId: number | null;
  eventIndex: number | null;
  minute: number;
  text: string;
  side: Side | null;
  tone: CommentaryTone;
}

export interface SelectionView {
  locked: boolean;
  cardInstanceId: string | null;
}

export interface MatchResultView {
  winner: Side | null;
  manOfTheMatch: { playerId: string; side: Side; rating: number } | null;
  scorers: { playerId: string; side: Side; minute: number }[];
}

export interface MatchView {
  exhibition?: ExhibitionOptions;
  roomCode: string;
  you: Side;
  phase: MatchPhase;
  /** Server epoch ms when the current phase times out (null = waits for players). */
  phaseEndsAt: number | null;
  serverNow: number;
  turn: number;
  turnsPerHalf: number;
  totalTurns: number;
  half: 1 | 2;
  /** In-game minute at the start of the current turn. */
  minute: number;
  attackingSide: Side | null;
  /** Side enjoying a counter-attack bonus this turn. */
  counterAttack: Side | null;
  score: Record<Side, number>;
  /** −100 (away dominating) … +100 (home dominating). */
  momentum: number;
  teams: Record<Side, TeamView>;
  hand: CardInstance[];
  selection: SelectionView;
  activeEffects: ActiveEffectView[];
  lastAction: ActionReport | null;
  commentary: CommentaryLine[];
  rematch: Record<Side, boolean>;
  result: MatchResultView | null;
  rules: {
    planningSeconds: number;
    halfTimeSeconds: number;
    maxSubstitutions: number;
    handLimit: number;
    minutesPerTurn: number;
    resolutionBufferMs: number;
  };
}
