import { otherSide, type Side } from '../../../shared/model/match';
import type { TeamState } from '../model/TeamState';

/** Decides which team attacks each turn: alternating by default, unless an effect (Siege) forces it. */
export class PossessionScheduler {
  private lastAttacker: Side | null = null;

  decide(isHalfKickoff: boolean, half: 1 | 2, forced: Side | null): Side {
    if (forced) return forced;
    if (isHalfKickoff || !this.lastAttacker) return half === 1 ? 'home' : 'away';
    return otherSide(this.lastAttacker);
  }

  record(attacker: Side): void {
    this.lastAttacker = attacker;
  }
}

/** Which team is on top. Stored from the home team's perspective (−100…100). */
export class MomentumMeter {
  private value = 0;

  get raw(): number {
    return Math.round(this.value);
  }

  forSide(side: Side): number {
    return side === 'home' ? this.value : -this.value;
  }

  shift(towards: Side, amount: number): void {
    const signed = towards === 'home' ? amount : -amount;
    this.value = Math.max(-100, Math.min(100, this.value + signed));
  }

  decay(factor = 0.85): void {
    this.value *= factor;
  }
}

/** Drains energy after every action: tired players perform worse, which makes half-time substitutions matter. */
export class FatigueModel {
  apply(team: TeamState, involved: ReadonlySet<string>, extraDrain: number): void {
    for (const fp of team.onPitch()) {
      const player = fp.player;
      let drain = 2.4 + (100 - player.profile.attributes.stamina) * 0.035;
      if (fp.role === 'GK') drain *= 0.4;
      if (involved.has(player.id)) drain += 1.2;
      drain += extraDrain;
      if (player.hasTrait('engine')) drain *= 0.6;
      player.drain(drain);
    }
  }

  recoverAtHalfTime(team: TeamState, amount = 12): void {
    for (const player of team.players.values()) player.recover(amount);
  }
}
