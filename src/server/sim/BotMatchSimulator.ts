import { SIDES, type Side } from '../../shared/model/match';
import { DEFAULT_RULES, type MatchRules } from '../../shared/rules';
import { BotManager } from '../ai/BotManager';
import { SeededRng } from '../core/Random';
import { ManualScheduler } from '../core/Scheduler';
import { SEED_PLAYERS, SEED_TEAMS } from '../data/seed';
import { Match, type MatchSummary } from '../match/Match';

export interface SimulationOptions {
  /** Fixes a side's mentality slider instead of letting its bot manage it. */
  mentality?: Partial<Record<Side, number>>;
}

/** Plays a complete bot-vs-bot match in fast-forward. Used for balancing and tests. */
export function simulateBotMatch(seed: number, rules: MatchRules = DEFAULT_RULES, swapTeams = false, options: SimulationOptions = {}): MatchSummary {
  const scheduler = new ManualScheduler();
  const rng = new SeededRng(seed);
  const [home, away] = swapTeams ? [SEED_TEAMS[1], SEED_TEAMS[0]] : SEED_TEAMS;
  const match = new Match(
    {
      roomCode: `SIM${seed}`,
      home: { team: home!, squad: SEED_PLAYERS.filter(p => p.teamId === home!.id) },
      away: { team: away!, squad: SEED_PLAYERS.filter(p => p.teamId === away!.id) },
    },
    { rules, rng, scheduler },
  );

  let summary: MatchSummary | null = null;
  match.onFinished(s => { summary = s; });
  const bots = SIDES.map(side =>
    new BotManager(match, side, scheduler, new SeededRng(seed * 31 + side.length), { fixedMentality: options.mentality?.[side] }));
  for (const side of SIDES) {
    match.assignManager(side, { clientId: `bot-${side}`, name: `Bot ${side}`, isBot: true, connected: true });
  }
  scheduler.runAll();
  bots.forEach(b => b.dispose());
  match.dispose();
  if (!summary) throw new Error(`Simulated match ${seed} did not finish (phase: ${match.phase}, turn ${match.state.turn})`);
  return summary;
}
