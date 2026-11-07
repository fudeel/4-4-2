import { isCardPlayable, type CardId, type CardInstance } from '../../shared/model/cards';
import { getFormation } from '../../shared/model/formation';
import { LineupBuilder, type Lineup } from '../../shared/model/lineup';
import { otherSide, type Side } from '../../shared/model/match';
import { overallRating } from '../../shared/model/player';
import type { Rng } from '../core/Random';
import type { Scheduler } from '../core/Scheduler';
import type { Match } from '../match/Match';
import type { MatchState } from '../match/flow/MatchState';
import type { TeamState } from '../match/model/TeamState';

/** Situation the bot weighs its cards against. */
interface Situation {
  attacking: boolean;
  goalDifference: number;
  turnsLeftInHalf: number;
  lateInMatch: boolean;
  averageEnergy: number;
  handFull: boolean;
}

type CardValuation = (s: Situation) => number;

const CARD_VALUES: Record<CardId, CardValuation> = {
  tiki_taka: () => 0.55,
  through_ball: () => 0.6,
  power_shot: () => 0.55,
  long_ball: () => 0.4,
  talisman: s => (s.goalDifference <= 0 ? 0.75 : 0.5),
  siege: s => (s.turnsLeftInHalf >= 3 ? (s.goalDifference <= 0 ? 0.95 : 0.6) : 0.05),
  simulation: s => (s.goalDifference < 0 ? 0.5 : 0.3),
  high_press: () => 0.5,
  park_the_bus: s => (s.goalDifference > 0 && s.lateInMatch ? 0.85 : 0.5),
  offside_trap: () => 0.45,
  tactical_foul: s => (s.goalDifference >= 0 && s.lateInMatch ? 0.6 : 0.3),
  keeper_heroics: () => 0.5,
  man_marking: () => 0.5,
  second_wind: s => (s.averageEnergy < 65 ? 0.8 : 0.1),
  team_talk: () => 0.5,
  mind_games: () => 0.3,
};

/**
 * A computer-controlled manager. It only uses the public `Match` commands, exactly like a human client,
 * and always acts through the scheduler (never re-entrantly inside a change notification).
 */
export class BotManager {
  private handledKey = '';
  private readonly unsubscribe: () => void;

  constructor(
    private readonly match: Match,
    private readonly side: Side,
    private readonly scheduler: Scheduler,
    private readonly rng: Rng,
  ) {
    this.unsubscribe = match.onChange(() => this.react());
  }

  dispose(): void {
    this.unsubscribe();
  }

  private get team(): TeamState {
    return this.match.state.team(this.side);
  }

  private react(): void {
    const state = this.match.state;
    const key = `${state.phase}:${state.turn}`;
    if (key === this.handledKey) return;

    switch (state.phase) {
      case 'lobby':
        if (this.team.ready) return;
        this.handledKey = key;
        this.later(this.rng.int(600, 1200), () => this.match.setReady(this.side, true));
        break;
      case 'planning':
        if (this.team.selection.locked) return;
        this.handledKey = key;
        this.later(this.rng.int(1200, 3500), () => this.match.playCard(this.side, this.chooseCard(state)?.instanceId ?? null));
        break;
      case 'halftime':
        this.handledKey = key;
        this.later(this.rng.int(1500, 3000), () => {
          this.makeSubstitutions();
          this.match.setReady(this.side, true);
        });
        break;
      default:
        break;
    }
  }

  private later(delayMs: number, action: () => void): void {
    const expectedKey = this.handledKey;
    this.scheduler.schedule(delayMs, () => {
      const state = this.match.state;
      if (`${state.phase}:${state.turn}` !== expectedKey) return;
      try {
        action();
      } catch {
        // The match moved on (or the move became invalid) — nothing to do.
      }
    });
  }

  private chooseCard(state: MatchState): CardInstance | null {
    const attacking = state.attackingSide === this.side;
    const playable = this.team.hand.list().filter(c => isCardPlayable(c.cardId, attacking));
    if (playable.length === 0) return null;

    const onPitch = this.team.onPitch();
    const situation: Situation = {
      attacking,
      goalDifference: state.score[this.side] - state.score[otherSide(this.side)],
      turnsLeftInHalf: state.turnsPerHalf - state.turnInHalf,
      lateInMatch: state.turn > state.totalTurns * 0.7,
      averageEnergy: onPitch.reduce((sum, fp) => sum + fp.player.energy, 0) / Math.max(1, onPitch.length),
      handFull: this.team.hand.isFull,
    };

    const scored = playable
      .map(card => ({ card, value: CARD_VALUES[card.cardId](situation) + this.rng.next() * 0.2 }))
      .sort((a, b) => b.value - a.value);
    const best = scored[0]!;
    const playChance = Math.min(0.95, best.value * 0.8 + (situation.handFull ? 0.25 : 0));
    return this.rng.chance(playChance) ? best.card : null;
  }

  /** Replaces the most tired outfielders with fresh bench players of the same position. */
  private makeSubstitutions(): void {
    const team = this.team;
    let lineup: Lineup = { ...team.lineup, slots: [...team.lineup.slots] };
    const formation = getFormation(lineup.formationId);
    const unavailable = team.unavailable();
    const used = new Set(LineupBuilder.onPitch(lineup));
    const tired = team
      .outfield()
      .filter(fp => fp.player.energy < 70)
      .sort((a, b) => a.player.energy - b.player.energy)
      .slice(0, team.substitutionsLeft());

    for (const fp of tired) {
      const role = formation.slots[fp.slot]!.role;
      const replacement = team.squad
        .filter(p => !used.has(p.id) && !unavailable.has(p.id) && p.position !== 'GK')
        .sort((a, b) => overallRating(b, role) - overallRating(a, role))[0];
      if (!replacement || overallRating(replacement, role) < overallRating(fp.player.profile, role) * fp.player.fatigueFactor() - 2) continue;
      lineup = LineupBuilder.placePlayer(lineup, fp.slot, replacement.id);
      used.add(replacement.id);
    }

    try {
      this.match.submitLineup(this.side, lineup);
    } catch {
      // Keep the current lineup if anything about the plan was invalid.
    }
  }
}
