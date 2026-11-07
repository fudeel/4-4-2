import { CARD_DEFINITIONS, type CardInstance } from '../../../shared/model/cards';
import { otherSide, type ActionReport, type MatchEvent, type RevealedCard, type Side } from '../../../shared/model/match';
import type { Rng } from '../../core/Random';
import { CardEffectRegistry } from '../cards/CardEffects';
import { ActionResolver } from '../engine/ActionResolver';
import { ModifierStack, type ActionModifier } from '../engine/modifiers';
import { FatigueModel } from './MatchDynamics';
import type { MatchState } from './MatchState';

const COUNTER_ATTACK_BONUS = 1.15;

interface PlayedCard {
  side: Side;
  card: CardInstance;
}

/** Resolves a single turn: reveal cards → activate their effects → play the action → apply consequences. */
export class TurnResolver {
  constructor(
    private readonly rng: Rng,
    private readonly resolver = new ActionResolver(),
    private readonly cardEffects = new CardEffectRegistry(),
    private readonly fatigue = new FatigueModel(),
  ) {}

  resolve(state: MatchState): ActionReport {
    const attackSide = state.attackingSide;
    if (!attackSide) throw new Error('No attacking side for this turn');
    const defenseSide = otherSide(attackSide);
    const attack = state.team(attackSide);
    const defense = state.team(defenseSide);
    const { minutesPerTurn } = state.rules;
    const minute = this.rng.int((state.turn - 1) * minutesPerTurn + 1, state.turn * minutesPerTurn);
    const scoreBefore = { ...state.score };

    // 1. Reveal and activate cards.
    const revealed = this.reveal(state);
    const modifiers: ActionModifier[] = [...state.effects.carriedModifiers(state.turn)];
    const notes: string[] = [];
    for (const card of revealed.filter(c => !c.cancelled)) {
      const team = state.team(card.side);
      team.stats.cardsPlayed += 1;
      const activation = this.cardEffects.get(card.cardId).activate({
        owner: card.side,
        turn: state.turn,
        team,
        opponent: state.team(otherSide(card.side)),
        effects: state.effects,
        rng: this.rng,
      });
      modifiers.push(...activation.modifiers);
      if (activation.note) notes.push(activation.note);
    }
    if (state.counterAttack === attackSide) {
      modifiers.push({
        owner: attackSide,
        teamMultiplier: (stage, side) => (side === attackSide && (stage === 'buildup' || stage === 'chance') ? COUNTER_ATTACK_BONUS : 1),
      });
    }

    // 2. Play the action.
    const ctx = this.resolver.resolve({
      attack,
      defense,
      modifiers: new ModifierStack(modifiers),
      rng: this.rng,
      minute,
      momentumFor: side => state.momentum.forSide(side),
    });

    // 3. Apply consequences.
    if (ctx.goal) {
      state.score[attackSide] += 1;
      state.goals.push({ playerId: ctx.goal.scorer.id, side: attackSide, minute });
    }
    attack.stats.xg += ctx.xg;
    this.applyMomentum(state, attackSide, ctx.momentumShift);
    state.counterAttack = ctx.counterAttack ? defenseSide : null;
    this.fatigue.apply(attack, ctx.involved, state.effects.extraFatigue(attackSide));
    this.fatigue.apply(defense, ctx.involved, state.effects.extraFatigue(defenseSide));
    state.effects.tick(state.turn);
    state.possession.record(attackSide);

    // 4. Report.
    const events: MatchEvent[] = [];
    if (revealed.length > 0) events.push(this.revealEvent(state, revealed, notes, attackSide));
    events.push(...ctx.events);
    const report: ActionReport = {
      id: ++state.actionCounter,
      turn: state.turn,
      minute,
      attackingSide: attackSide,
      revealed,
      events,
      outcome: ctx.outcome,
      scoreBefore,
      scoreAfter: { ...state.score },
      durationMs: events.reduce((sum, e) => sum + e.durationMs, 0),
    };
    state.commentary.addActionEvents(report.id, minute, events);
    return report;
  }

  /** Takes the selected cards out of both hands. Mind Games cancels whatever the opponent played. */
  private reveal(state: MatchState): RevealedCard[] {
    const played: PlayedCard[] = [];
    for (const side of ['home', 'away'] as const) {
      const team = state.team(side);
      const id = team.selection.cardInstanceId;
      const card = id ? team.hand.remove(id) : undefined;
      if (card) played.push({ side, card });
    }
    return played.map(({ side, card }) => ({
      side,
      cardId: card.cardId,
      cancelled: played.some(other => other.side !== side && other.card.cardId === 'mind_games'),
    }));
  }

  private revealEvent(state: MatchState, revealed: RevealedCard[], notes: string[], attackSide: Side): MatchEvent {
    const parts = revealed.map(card => {
      const def = CARD_DEFINITIONS[card.cardId];
      const team = state.team(card.side).profile.shortName;
      return `${team} ${def.icon} ${def.name}${card.cancelled ? ' — cancelled by Mind Games!' : ''}`;
    });
    return {
      kind: 'cards',
      side: revealed[0]?.side ?? attackSide,
      text: [parts.join(' · '), ...notes].join(' '),
      durationMs: 1700,
    };
  }

  /** Momentum decays every turn, then swings towards whoever came out on top. Leaders soften setbacks. */
  private applyMomentum(state: MatchState, attackSide: Side, shift: number): void {
    state.momentum.decay();
    const loser = shift >= 0 ? otherSide(attackSide) : attackSide;
    const dampened = state.team(loser).hasTraitOnPitch('leader') ? shift * 0.85 : shift;
    state.momentum.shift(attackSide, dampened);
  }
}
