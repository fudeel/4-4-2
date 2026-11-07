import { describe, expect, it } from 'vitest';
import { LineupBuilder, LineupValidator } from '../src/shared/model/lineup';
import { DEFAULT_RULES, totalTurns } from '../src/shared/rules';
import { SeededRng } from '../src/server/core/Random';
import { ManualScheduler } from '../src/server/core/Scheduler';
import { SEED_PLAYERS, SEED_TEAMS } from '../src/server/data/seed';
import { Match } from '../src/server/match/Match';
import { simulateBotMatch } from '../src/server/sim/BotMatchSimulator';
import type { CardId } from '../src/shared/model/cards';
import type { Side } from '../src/shared/model/match';

const squadOf = (teamId: string) => SEED_PLAYERS.filter(p => p.teamId === teamId);

function createHumanMatch(seed = 7) {
  const scheduler = new ManualScheduler();
  const [home, away] = SEED_TEAMS;
  const match = new Match(
    { roomCode: 'TEST', home: { team: home!, squad: squadOf(home!.id) }, away: { team: away!, squad: squadOf(away!.id) } },
    { rules: DEFAULT_RULES, rng: new SeededRng(seed), scheduler },
  );
  for (const side of ['home', 'away'] as const) {
    match.assignManager(side, { clientId: side, name: side, isBot: false, connected: true });
  }
  match.setReady('home', true);
  match.setReady('away', true);
  return { match, scheduler };
}

/** Puts a specific card in a team's hand and returns its instance id. */
function giveCard(match: Match, side: Side, cardId: CardId): string {
  const hand = match.state.team(side).hand;
  const first = hand.list()[0];
  if (hand.isFull && first) hand.remove(first.instanceId);
  const instanceId = `test-${cardId}-${Math.random()}`;
  hand.add({ instanceId, cardId });
  return instanceId;
}

/** Skips the rest of the current turn and waits for the next planning phase. */
function finishTurn(match: Match, scheduler: ManualScheduler): void {
  for (const side of ['home', 'away'] as const) {
    if (!match.state.team(side).selection.locked) match.playCard(side, null);
  }
  advanceToNextPhase(match, scheduler);
}

function advanceToNextPhase(match: Match, scheduler: ManualScheduler): void {
  scheduler.advance((match.state.phaseEndsAt ?? scheduler.now()) - scheduler.now());
}

describe('full match', () => {
  it('plays every turn and ends at full time with a consistent score', () => {
    const { state, result } = simulateBotMatch(42);
    expect(state.phase).toBe('fulltime');
    expect(state.turn).toBe(totalTurns(DEFAULT_RULES));
    expect(state.goals.length).toBe(state.score.home + state.score.away);
    expect(result.manOfTheMatch).not.toBeNull();
  });

  it('is deterministic for the same seed', () => {
    const a = simulateBotMatch(1234);
    const b = simulateBotMatch(1234);
    expect(a.state.score).toEqual(b.state.score);
    expect(a.state.goals).toEqual(b.state.goals);
  });
});

describe('turn flow', () => {
  it('alternates possession by default', () => {
    const { match, scheduler } = createHumanMatch();
    expect(match.phase).toBe('planning');
    expect(match.state.attackingSide).toBe('home');
    finishTurn(match, scheduler);
    expect(match.state.attackingSide).toBe('away');
    finishTurn(match, scheduler);
    expect(match.state.attackingSide).toBe('home');
  });

  it('auto-skips when the planning timer runs out', () => {
    const { match, scheduler } = createHumanMatch();
    scheduler.advance(DEFAULT_RULES.planningSeconds * 1000);
    expect(match.phase).toBe('resolving');
    expect(match.state.lastAction?.turn).toBe(1);
  });

  it('Siege gives three attacks in a row', () => {
    const { match, scheduler } = createHumanMatch();
    match.playCard('home', giveCard(match, 'home', 'siege'));
    finishTurn(match, scheduler);
    expect(match.state.attackingSide).toBe('home');
    finishTurn(match, scheduler);
    expect(match.state.attackingSide).toBe('home');
    finishTurn(match, scheduler);
    expect(match.state.attackingSide).toBe('away');
  });

  it('Mind Games cancels the opponent card', () => {
    const { match, scheduler } = createHumanMatch();
    match.playCard('home', giveCard(match, 'home', 'through_ball'));
    match.playCard('away', giveCard(match, 'away', 'mind_games'));
    const revealed = match.state.lastAction?.revealed ?? [];
    expect(revealed.find(c => c.side === 'home')?.cancelled).toBe(true);
    expect(revealed.find(c => c.side === 'away')?.cancelled).toBe(false);
    advanceToNextPhase(match, scheduler);
    expect(match.phase).toBe('planning');
  });

  it('rejects attack cards while defending', () => {
    const { match } = createHumanMatch();
    expect(() => match.playCard('away', giveCard(match, 'away', 'power_shot'))).toThrow(/attack/);
  });

  it('never reveals the opponent hand', () => {
    const { match } = createHumanMatch();
    const id = giveCard(match, 'away', 'keeper_heroics');
    match.playCard('away', id);
    const homeView = match.view('home');
    expect(JSON.stringify(homeView)).not.toContain(id);
    expect(homeView.teams.away.locked).toBe(true);
    expect(homeView.hand.every(c => match.state.team('home').hand.find(c.instanceId))).toBe(true);
  });

  it('reaches half-time after nine turns and allows substitutions', () => {
    const { match, scheduler } = createHumanMatch();
    for (let i = 0; i < 9; i++) finishTurn(match, scheduler);
    expect(match.phase).toBe('halftime');
    const team = match.state.team('home');
    const bench = team.squad.find(p => p.position === 'MID' && !team.lineup.slots.includes(p.id))!;
    const midSlot = team.lineup.slots.findIndex((id, i) => i > 0 && team.player(id!).position === 'MID');
    const starter = team.lineup.slots[midSlot]!;
    match.submitLineup('home', LineupBuilder.placePlayer(team.lineup, midSlot, bench.id));
    expect(match.view('home').teams.home.subsUsed).toBe(1);

    // Changing your mind during the break doesn't burn extra substitutions.
    match.submitLineup('home', LineupBuilder.placePlayer(team.lineup, midSlot, starter));
    expect(match.view('home').teams.home.subsUsed).toBe(0);
    match.submitLineup('home', LineupBuilder.placePlayer(team.lineup, midSlot, bench.id));

    match.setReady('home', true);
    match.setReady('away', true);
    expect(match.phase).toBe('planning');
    expect(team.subsUsed).toBe(1);
    expect(team.player(starter).subbedOff).toBe(true);
    expect(team.player(bench.id).appeared).toBe(true);
  });
});

describe('lineup rules', () => {
  const squad = squadOf('rmu');
  const validator = new LineupValidator();

  it('builds a valid best lineup for every formation', () => {
    for (const formation of ['2-2-1', '3-1-1', '2-1-2', '1-3-1', '1-2-2'] as const) {
      const lineup = LineupBuilder.best(formation, squad);
      const check = validator.validate(lineup, { squad, unavailable: new Set(), requiredPlayers: 6 });
      expect(check.ok).toBe(true);
      expect(squad.find(p => p.id === lineup.slots[0])?.position).toBe('GK');
    }
  });

  it('limits substitutions', () => {
    const lineup = LineupBuilder.best('2-2-1', squad);
    const bench = squad.filter(p => !lineup.slots.includes(p.id) && p.position !== 'GK').slice(0, 4);
    const changed = { ...lineup, slots: [lineup.slots[0]!, ...bench.map(p => p.id), lineup.slots[5]!].slice(0, 6) };
    const check = validator.validate(changed, {
      squad, unavailable: new Set(), requiredPlayers: 6, currentlyOnPitch: new Set(lineup.slots as string[]), substitutionsLeft: 3,
    });
    expect(check.ok).toBe(false);
  });
});

describe('mentality', () => {
  it('is clamped to the slider range and snapped to its step', () => {
    const { match } = createHumanMatch();
    match.setMentality('home', 137);
    expect(match.view('home').teams.home.mentality).toBe(100);
    match.setMentality('home', -44);
    expect(match.view('away').teams.home.mentality).toBe(-40);
  });

  it('can be changed during the match but not after full time', () => {
    const { match, scheduler } = createHumanMatch();
    for (let i = 0; i < 9; i++) finishTurn(match, scheduler);
    match.setMentality('away', 50);
    match.setReady('home', true);
    match.setReady('away', true);
    for (let i = 0; i < 9; i++) finishTurn(match, scheduler);
    expect(match.phase).toBe('fulltime');
    expect(() => match.setMentality('home', -100)).toThrow(/over/);
  });

  it('trades attack for defence: defensive teams foul more and concede less, attacking teams score and concede more', () => {
    const run = (home: number) => {
      const totals = { fouls: 0, scored: 0, conceded: 0 };
      for (let seed = 1; seed <= 200; seed++) {
        const { state } = simulateBotMatch(seed, undefined, false, { mentality: { home, away: 0 } });
        totals.fouls += state.team('home').stats.fouls;
        totals.scored += state.score.home;
        totals.conceded += state.score.away;
      }
      return totals;
    };
    const balanced = run(0);
    const defensive = run(-100);
    const attacking = run(100);
    expect(defensive.fouls).toBeGreaterThan(balanced.fouls * 1.2);
    expect(defensive.conceded).toBeLessThan(balanced.conceded);
    expect(defensive.scored).toBeLessThan(balanced.scored);
    expect(attacking.scored).toBeGreaterThan(balanced.scored);
    expect(attacking.conceded).toBeGreaterThan(balanced.conceded);
  });
});
