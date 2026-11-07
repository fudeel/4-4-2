import { CARD_DEFINITIONS, CARD_TUNING, type CardId } from '../../../shared/model/cards';
import type { RollStage, Side } from '../../../shared/model/match';
import { surname } from '../../../shared/model/player';
import type { Rng } from '../../core/Random';
import type { ActionContext } from '../engine/ActionContext';
import type { ActionModifier, PhaseKind } from '../engine/modifiers';
import { SKILLS } from '../engine/RatingCalculator';
import type { ActiveEffectList } from '../effects/ActiveEffects';
import type { MatchPlayer } from '../model/MatchPlayer';
import type { TeamState } from '../model/TeamState';

export interface CardActivationContext {
  owner: Side;
  turn: number;
  team: TeamState;
  opponent: TeamState;
  effects: ActiveEffectList;
  rng: Rng;
}

export interface CardActivation {
  /** Modifiers applied to this turn's action. */
  modifiers: ActionModifier[];
  /** Optional line for the commentary when the card is revealed. */
  note?: string;
}

/** Strategy for what a card does when it is revealed. One class per card. */
export interface CardEffect {
  activate(ctx: CardActivationContext): CardActivation;
}

const FINISHING_STAGES: RollStage[] = ['shot', 'penalty', 'free_kick'];

/** Multiplies the owner's team strength at the given stages. */
function teamBoost(owner: Side, stages: RollStage[], multiplier: number): ActionModifier {
  return { owner, teamMultiplier: (stage, side) => (side === owner && stages.includes(stage) ? multiplier : 1) };
}

/** Best on-pitch outfielder of a team at attacking, by shooting + dribbling. */
function bestAttacker(team: TeamState): MatchPlayer | null {
  const score = (p: MatchPlayer) => p.profile.attributes.shooting * 0.6 + p.profile.attributes.dribbling * 0.4;
  const candidates = team.inRoles('FWD', 'MID').map(fp => fp.player);
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** A modifier that intercepts at most once per action. */
abstract class OneShotInterceptor implements ActionModifier {
  private used = false;
  abstract readonly priority: number;

  constructor(readonly owner: Side) {}

  intercept(phase: PhaseKind, ctx: ActionContext): PhaseKind | null | undefined {
    if (this.used || !this.triggersOn(phase)) return undefined;
    this.used = true;
    return this.trigger(phase, ctx);
  }

  protected abstract triggersOn(phase: PhaseKind): boolean;
  protected abstract trigger(phase: PhaseKind, ctx: ActionContext): PhaseKind | null | undefined;
}

// ── Attack cards ───────────────────────────────────────────────────────────────

class TikiTakaEffect implements CardEffect {
  activate({ owner }: CardActivationContext): CardActivation {
    return { modifiers: [teamBoost(owner, ['buildup'], 1 + CARD_TUNING.tikiTaka.buildUpBonus)] };
  }
}

class ThroughBallEffect implements CardEffect {
  activate({ owner }: CardActivationContext): CardActivation {
    return { modifiers: [teamBoost(owner, ['chance'], 1 + CARD_TUNING.throughBall.chanceBonus)] };
  }
}

class PowerShotEffect implements CardEffect {
  activate({ owner }: CardActivationContext): CardActivation {
    const bonus = 1 + CARD_TUNING.powerShot.shootingBonus;
    return {
      modifiers: [{ owner, playerMultiplier: (_p, stage, side) => (side === owner && FINISHING_STAGES.includes(stage) ? bonus : 1) }],
    };
  }
}

class LongBallInterceptor extends OneShotInterceptor {
  readonly priority = 5;

  protected triggersOn(phase: PhaseKind): boolean {
    return phase === 'buildup';
  }

  protected trigger(_phase: PhaseKind, ctx: ActionContext): PhaseKind {
    const passer = ctx.best(ctx.attack, SKILLS.passing, ['DEF', 'MID'])?.player ?? null;
    const target = ctx.pick(ctx.attack, { MID: 0.3, FWD: 1 }, { pace: 0.5, physical: 0.5 }, [passer])?.player ?? null;
    if (passer && target) {
      ctx.emit({ kind: 'long_ball', side: ctx.attackSide, actorId: passer.id, targetId: target.id, text: ctx.commentary.line('longBall', passer, target) });
      ctx.carrier = target;
    }
    ctx.flags.longBall = true;
    return 'chance';
  }
}

class LongBallEffect implements CardEffect {
  activate({ owner }: CardActivationContext): CardActivation {
    return { modifiers: [new LongBallInterceptor(owner), teamBoost(owner, ['chance'], 1 - CARD_TUNING.longBall.chancePenalty)] };
  }
}

class TalismanEffect implements CardEffect {
  activate({ owner, team }: CardActivationContext): CardActivation {
    const star = bestAttacker(team);
    if (!star) return { modifiers: [] };
    const bonus = 1 + CARD_TUNING.talisman.statBonus;
    return {
      modifiers: [{
        owner,
        playerMultiplier: player => (player.id === star.id ? bonus : 1),
        chooseShooter: ctx => (ctx.attack.fieldPlayer(star.id) ? star : null),
      }],
      note: `${surname(star.name)} demands the ball.`,
    };
  }
}

class SiegeEffect implements CardEffect {
  activate({ owner, turn, effects }: CardActivationContext): CardActivation {
    const { extraAttacks, extraFatigue } = CARD_TUNING.siege;
    effects.add({
      id: `siege-${owner}-${turn}`,
      cardId: 'siege',
      owner,
      label: 'Siege',
      remainingTurns: extraAttacks,
      createdTurn: turn,
      forcedAttacker: owner,
      extraFatigue,
      modifiers: () => [],
    });
    return { modifiers: [], note: `They're camped in the opposition half — ${extraAttacks + 1} attacks in a row!` };
  }
}

class SimulationInterceptor extends OneShotInterceptor {
  readonly priority = 30;

  protected triggersOn(phase: PhaseKind): boolean {
    return phase === 'chance';
  }

  protected trigger(_phase: PhaseKind, ctx: ActionContext): PhaseKind | null | undefined {
    const diver = ctx.best(ctx.attack, { dribbling: 0.7, pace: 0.3 }, ['FWD', 'MID'])?.player;
    if (!diver) return undefined;
    const roll = ctx.roll('special', 'Simulation', CARD_TUNING.simulation.penaltyChance, ctx.attackSide);
    if (roll.success) {
      ctx.defense.stats.fouls += 1;
      ctx.emit({ kind: 'dive', side: ctx.attackSide, actorId: diver.id, text: ctx.commentary.line('dive', diver), roll });
      return 'penalty';
    }
    const booking = ctx.book(diver, { yellowChance: 1, forceYellow: true });
    ctx.emit({ kind: 'dive', side: ctx.attackSide, actorId: diver.id, text: ctx.commentary.line('diveBooked', diver), roll, booking });
    ctx.outcome = 'foul';
    ctx.momentumShift -= 8;
    return null;
  }
}

class SimulationEffect implements CardEffect {
  activate({ owner }: CardActivationContext): CardActivation {
    return { modifiers: [new SimulationInterceptor(owner)] };
  }
}

// ── Defense cards ──────────────────────────────────────────────────────────────

class HighPressEffect implements CardEffect {
  activate({ owner }: CardActivationContext): CardActivation {
    return {
      modifiers: [{
        ...teamBoost(owner, ['buildup'], 1 + CARD_TUNING.highPress.pressBonus),
        afterPhase: (phase, attackSucceeded, ctx) => {
          if (phase === 'buildup' && !attackSucceeded) ctx.counterAttack = true;
        },
      }],
    };
  }
}

class ParkTheBusEffect implements CardEffect {
  activate({ owner }: CardActivationContext): CardActivation {
    const { defenseBonus, blockBonus } = CARD_TUNING.parkTheBus;
    return {
      modifiers: [{
        ...teamBoost(owner, ['chance'], 1 + defenseBonus),
        probabilityBonus: (stage, side) => (stage === 'block' && side === owner ? blockBonus : 0),
      }],
    };
  }
}

class OffsideTrapInterceptor extends OneShotInterceptor {
  readonly priority = 10;

  protected triggersOn(phase: PhaseKind): boolean {
    return phase === 'chance';
  }

  protected trigger(_phase: PhaseKind, ctx: ActionContext): PhaseKind | null {
    const { successChance, vsLongBallBonus, beatenQualityBonus } = CARD_TUNING.offsideTrap;
    const runner = ctx.best(ctx.attack, { pace: 0.7, dribbling: 0.3 }, ['FWD', 'MID'])?.player ?? ctx.carrier;
    if (!runner) return null;
    const chance = successChance + (ctx.flags.longBall ? vsLongBallBonus : 0);
    const roll = ctx.roll('special', 'Offside trap', chance, ctx.defenseSide);
    if (roll.success) {
      ctx.emit({ kind: 'offside', side: ctx.defenseSide, actorId: runner.id, text: ctx.commentary.line('offside', runner), roll });
      ctx.outcome = 'offside';
      ctx.momentumShift -= 6;
      return null;
    }
    // Trap beaten: a clean 1-on-1 with the keeper.
    ctx.flags.oneOnOne = true;
    ctx.shooter = runner;
    ctx.creator = ctx.carrier && ctx.carrier !== runner ? ctx.carrier : null;
    ctx.chanceQuality = Math.min(1, 0.6 + beatenQualityBonus);
    ctx.attack.stats.chancesCreated += 1;
    ctx.momentumShift += 8;
    ctx.emit({ kind: 'through_ball', side: ctx.attackSide, actorId: ctx.creator?.id ?? runner.id, targetId: runner.id, text: ctx.commentary.line('offsideBeaten', runner), roll });
    return 'shot';
  }
}

class OffsideTrapEffect implements CardEffect {
  activate({ owner }: CardActivationContext): CardActivation {
    return { modifiers: [new OffsideTrapInterceptor(owner)] };
  }
}

class TacticalFoulInterceptor extends OneShotInterceptor {
  readonly priority = 20;

  protected triggersOn(phase: PhaseKind): boolean {
    return phase === 'buildup' || phase === 'chance';
  }

  protected trigger(phase: PhaseKind, ctx: ActionContext): PhaseKind | null {
    const fouler = ctx.pick(ctx.defense, { DEF: 0.8, MID: 1, FWD: 0.3 }, { defending: 0.5, physical: 0.5 })?.player;
    const victim = ctx.carrier ?? ctx.best(ctx.attack, SKILLS.passing)?.player ?? null;
    if (!fouler) return phase === 'buildup' ? 'chance' : 'shot';
    const booking = ctx.book(fouler, { yellowChance: 1, forceYellow: true });
    ctx.defense.stats.fouls += 1;
    const nearBox = phase === 'chance';
    const text = nearBox
      ? `${ctx.commentary.line('foul', fouler, victim)} Cynical — but it's a free kick on the edge of the box!`
      : `${ctx.commentary.line('foul', fouler, victim)} Cynical, but it kills the attack.`;
    ctx.emit({ kind: 'foul', side: ctx.defenseSide, actorId: fouler.id, targetId: victim?.id, text, booking });
    if (nearBox) return 'free_kick';
    ctx.outcome = 'foul';
    ctx.momentumShift -= 4;
    return null;
  }
}

class TacticalFoulEffect implements CardEffect {
  activate({ owner }: CardActivationContext): CardActivation {
    return { modifiers: [new TacticalFoulInterceptor(owner)] };
  }
}

class KeeperHeroicsEffect implements CardEffect {
  activate({ owner }: CardActivationContext): CardActivation {
    const bonus = 1 + CARD_TUNING.keeperHeroics.keeperBonus;
    return {
      modifiers: [{ owner, playerMultiplier: (_p, stage, side) => (side === owner && FINISHING_STAGES.includes(stage) ? bonus : 1) }],
    };
  }
}

class ManMarkingEffect implements CardEffect {
  activate({ owner, opponent }: CardActivationContext): CardActivation {
    const target = bestAttacker(opponent);
    if (!target) return { modifiers: [] };
    const factor = 1 - CARD_TUNING.manMarking.markPenalty;
    return {
      modifiers: [{ owner, playerMultiplier: player => (player.id === target.id ? factor : 1) }],
      note: `${surname(target.name)} has a shadow for the next five minutes.`,
    };
  }
}

// ── Any-time cards ─────────────────────────────────────────────────────────────

class SecondWindEffect implements CardEffect {
  activate({ team }: CardActivationContext): CardActivation {
    for (const fp of team.onPitch()) fp.player.recover(CARD_TUNING.secondWind.energy);
    return { modifiers: [], note: 'A quick drinks break — legs feel fresh again.' };
  }
}

class TeamTalkEffect implements CardEffect {
  activate({ owner, turn, effects }: CardActivationContext): CardActivation {
    const { bonus, turns } = CARD_TUNING.teamTalk;
    const modifier = (): ActionModifier => ({ owner, playerMultiplier: (_p, _stage, side) => (side === owner ? 1 + bonus : 1) });
    effects.add({
      id: `team-talk-${owner}-${turn}`,
      cardId: 'team_talk',
      owner,
      label: 'Team Talk',
      remainingTurns: turns - 1,
      createdTurn: turn,
      modifiers: () => [modifier()],
    });
    return { modifiers: [modifier()], note: 'The manager is on the touchline, roaring them on.' };
  }
}

/** Mind Games is resolved before activation (it cancels the opponent's card), so it has no effect of its own. */
class MindGamesEffect implements CardEffect {
  activate(): CardActivation {
    return { modifiers: [] };
  }
}

export class CardEffectRegistry {
  private readonly effects: Record<CardId, CardEffect> = {
    tiki_taka: new TikiTakaEffect(),
    through_ball: new ThroughBallEffect(),
    power_shot: new PowerShotEffect(),
    long_ball: new LongBallEffect(),
    talisman: new TalismanEffect(),
    siege: new SiegeEffect(),
    simulation: new SimulationEffect(),
    high_press: new HighPressEffect(),
    park_the_bus: new ParkTheBusEffect(),
    offside_trap: new OffsideTrapEffect(),
    tactical_foul: new TacticalFoulEffect(),
    keeper_heroics: new KeeperHeroicsEffect(),
    man_marking: new ManMarkingEffect(),
    second_wind: new SecondWindEffect(),
    team_talk: new TeamTalkEffect(),
    mind_games: new MindGamesEffect(),
  };

  get(cardId: CardId): CardEffect {
    return this.effects[cardId];
  }

  name(cardId: CardId): string {
    return CARD_DEFINITIONS[cardId].name;
  }
}
