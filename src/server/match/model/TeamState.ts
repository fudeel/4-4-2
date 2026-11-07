import { getFormation } from '../../../shared/model/formation';
import { LineupValidator, type Lineup, type LineupRules } from '../../../shared/model/lineup';
import type { ManagerView, Side, TeamMatchStats } from '../../../shared/model/match';
import type { PlayerProfile, Position, TraitId } from '../../../shared/model/player';
import { MENTALITY, normalizeMentality } from '../../../shared/model/tactics';
import type { TeamProfile } from '../../../shared/model/team';
import type { MatchRules } from '../../../shared/rules';
import { GameError } from '../../core/GameError';
import { CardDealer, CardHand } from '../cards/CardHand';
import { MatchPlayer } from './MatchPlayer';

/** A player currently on the pitch, with the role of the slot they occupy. */
export interface FieldPlayer {
  player: MatchPlayer;
  role: Position;
  slot: number;
}

export interface Manager {
  clientId: string;
  name: string;
  isBot: boolean;
  connected: boolean;
}

export interface CardSelection {
  locked: boolean;
  cardInstanceId: string | null;
}

const emptyStats = (): TeamMatchStats => ({
  attacks: 0, chancesCreated: 0, shots: 0, shotsOnTarget: 0, xg: 0,
  fouls: 0, corners: 0, yellowCards: 0, redCards: 0, cardsPlayed: 0,
});

export class TeamState {
  readonly players: Map<string, MatchPlayer>;
  readonly hand: CardHand;
  lineup: Lineup;
  manager: Manager | null = null;
  ready = false;
  subsUsed = 0;
  selection: CardSelection = { locked: false, cardInstanceId: null };
  /** −100 (all behind the ball) … +100 (all forward). Applied from the next action on. */
  mentality: number = MENTALITY.initial;
  /** Mentality used in the last resolved action, to announce changes in the commentary. */
  appliedMentality: number = MENTALITY.initial;
  readonly stats: TeamMatchStats = emptyStats();
  /** Players on the pitch when half-time started (null outside the break). */
  private halfTimeBaseline: Set<string> | null = null;

  constructor(
    readonly side: Side,
    readonly profile: TeamProfile,
    readonly squad: readonly PlayerProfile[],
    readonly dealer: CardDealer,
    private readonly rules: MatchRules,
    initialLineup: Lineup,
    private readonly validator = new LineupValidator(),
  ) {
    this.players = new Map(squad.map(p => [p.id, new MatchPlayer(p)]));
    this.hand = new CardHand(rules.handLimit);
    this.lineup = initialLineup;
  }

  player(id: string): MatchPlayer {
    const player = this.players.get(id);
    if (!player) throw new Error(`Unknown player ${id}`);
    return player;
  }

  onPitch(): FieldPlayer[] {
    const formation = getFormation(this.lineup.formationId);
    const result: FieldPlayer[] = [];
    this.lineup.slots.forEach((id, slot) => {
      if (id !== null) result.push({ player: this.player(id), role: formation.slots[slot]!.role, slot });
    });
    return result;
  }

  inRoles(...roles: Position[]): FieldPlayer[] {
    return this.onPitch().filter(fp => roles.includes(fp.role));
  }

  outfield(): FieldPlayer[] {
    return this.onPitch().filter(fp => fp.role !== 'GK');
  }

  goalkeeper(): FieldPlayer | null {
    return this.onPitch().find(fp => fp.role === 'GK') ?? null;
  }

  fieldPlayer(playerId: string): FieldPlayer | undefined {
    return this.onPitch().find(fp => fp.player.id === playerId);
  }

  hasTraitOnPitch(trait: TraitId): boolean {
    return this.onPitch().some(fp => fp.player.hasTrait(trait));
  }

  sentOffCount(): number {
    return [...this.players.values()].filter(p => p.sentOff).length;
  }

  requiredPlayers(): number {
    return this.rules.playersPerSide - this.sentOffCount();
  }

  unavailable(): Set<string> {
    return new Set([...this.players.values()].filter(p => p.sentOff || p.subbedOff).map(p => p.id));
  }

  substitutionsLeft(): number {
    return this.rules.maxSubstitutions - this.subsUsed;
  }

  lineupRules(): LineupRules {
    return {
      squad: this.squad,
      unavailable: this.unavailable(),
      requiredPlayers: this.requiredPlayers(),
      currentlyOnPitch: this.halfTimeBaseline ?? undefined,
      substitutionsLeft: this.substitutionsLeft(),
    };
  }

  /**
   * Validates and applies a lineup. At half-time, players not on the pitch when the
   * break started count as substitutions; they are committed when play resumes,
   * so managers can change their mind freely during the break.
   */
  applyLineup(lineup: Lineup): void {
    const check = this.validator.validate(lineup, this.lineupRules());
    if (!check.ok) throw new GameError('invalid_lineup', check.error);
    this.lineup = { formationId: lineup.formationId, slots: [...lineup.slots] };
  }

  beginHalfTime(): void {
    this.halfTimeBaseline = new Set(this.onPitch().map(fp => fp.player.id));
  }

  /** Substitutions made during the break, not yet committed. */
  pendingSubstitutions(): number {
    const baseline = this.halfTimeBaseline;
    return baseline ? this.onPitch().filter(fp => !baseline.has(fp.player.id)).length : 0;
  }

  commitHalfTime(): void {
    const baseline = this.halfTimeBaseline;
    if (!baseline) return;
    const onPitch = new Set(this.onPitch().map(fp => fp.player.id));
    for (const id of onPitch) {
      if (!baseline.has(id)) {
        this.player(id).appeared = true;
        this.subsUsed += 1;
      }
    }
    for (const id of baseline) {
      if (!onPitch.has(id)) this.player(id).subbedOff = true;
    }
    this.halfTimeBaseline = null;
  }

  markStartersAppeared(): void {
    for (const fp of this.onPitch()) fp.player.appeared = true;
  }

  /**
   * Removes a sent-off player from the pitch. If it was the goalkeeper, the outfielder
   * with the best goalkeeping takes the gloves and their slot is left empty.
   */
  sendOff(playerId: string): void {
    const player = this.player(playerId);
    player.sentOff = true;
    const slots = [...this.lineup.slots];
    const slotIndex = slots.indexOf(playerId);
    if (slotIndex === -1) return;
    slots[slotIndex] = null;
    if (slotIndex === 0) {
      const emergency = slots
        .map((id, index) => ({ id, index }))
        .filter((s): s is { id: string; index: number } => s.id !== null)
        .sort((a, b) => this.player(b.id).profile.attributes.goalkeeping - this.player(a.id).profile.attributes.goalkeeping)[0];
      if (emergency) {
        slots[0] = emergency.id;
        slots[emergency.index] = null;
      }
    }
    this.lineup = { ...this.lineup, slots };
  }

  setMentality(value: number): void {
    this.mentality = normalizeMentality(value);
  }

  resetSelection(): void {
    this.selection = { locked: false, cardInstanceId: null };
  }

  managerView(): ManagerView | null {
    return this.manager ? { name: this.manager.name, isBot: this.manager.isBot, connected: this.manager.connected } : null;
  }
}
