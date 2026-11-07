/**
 * Balance report: plays many bot-vs-bot matches and prints averages.
 * Usage: npm run simulate -- 2000
 */
import { simulateBotMatch } from '../src/server/sim/BotMatchSimulator';

const matches = Number(process.argv[2] ?? 1000);
const swap = process.argv.includes('--swap');
const totals = { goals: 0, shots: 0, onTarget: 0, xg: 0, cards: 0, yellows: 0, reds: 0, corners: 0, fouls: 0, homeWins: 0, awayWins: 0, draws: 0, goalless: 0 };
const goalHistogram = new Map<number, number>();

for (let seed = 1; seed <= matches; seed++) {
  const { state, result } = simulateBotMatch(seed, undefined, swap);
  const goals = state.score.home + state.score.away;
  totals.goals += goals;
  goalHistogram.set(goals, (goalHistogram.get(goals) ?? 0) + 1);
  if (goals === 0) totals.goalless += 1;
  if (result.winner === 'home') totals.homeWins += 1;
  else if (result.winner === 'away') totals.awayWins += 1;
  else totals.draws += 1;
  for (const side of ['home', 'away'] as const) {
    const s = state.team(side).stats;
    totals.shots += s.shots;
    totals.onTarget += s.shotsOnTarget;
    totals.xg += s.xg;
    totals.cards += s.cardsPlayed;
    totals.yellows += s.yellowCards;
    totals.reds += s.redCards;
    totals.corners += s.corners;
    totals.fouls += s.fouls;
  }
}

const per = (n: number) => (n / matches).toFixed(2);
console.log(`\n${matches} simulated matches (bot vs bot)${swap ? ', teams swapped' : ''}\n`);
console.log(`Goals / match        ${per(totals.goals)}   (goalless ${((totals.goalless / matches) * 100).toFixed(1)}%)`);
console.log(`xG / match           ${per(totals.xg)}`);
console.log(`Shots / match        ${per(totals.shots)}   on target ${per(totals.onTarget)}`);
console.log(`Cards played / match ${per(totals.cards)}`);
console.log(`Fouls / match        ${per(totals.fouls)}   yellows ${per(totals.yellows)}   reds ${per(totals.reds)}`);
console.log(`Corners / match      ${per(totals.corners)}`);
console.log(`Results              home ${totals.homeWins}  draw ${totals.draws}  away ${totals.awayWins}`);
console.log('Goal distribution    ' + [...goalHistogram.entries()].sort((a, b) => a[0] - b[0]).map(([g, n]) => `${g}:${n}`).join('  '));
