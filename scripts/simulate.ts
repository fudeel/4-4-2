/**
 * Balance report: plays many bot-vs-bot matches and prints averages.
 * Usage: npm run simulate -- 2000 [--swap] [--home=-100] [--away=60]
 * (--home/--away fix that side's mentality slider instead of letting the bot manage it.)
 */
import { simulateBotMatch } from '../src/server/sim/BotMatchSimulator';

const matches = Number(process.argv[2] ?? 1000);
const swap = process.argv.includes('--swap');
const flag = (name: string): number | undefined => {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? Number(arg.split('=')[1]) : undefined;
};
const mentality = { home: flag('home'), away: flag('away') };
const fixed = (['home', 'away'] as const).filter(s => mentality[s] !== undefined).map(s => `${s} mentality ${mentality[s]}`);
const totals = { goals: 0, shots: 0, onTarget: 0, xg: 0, cards: 0, yellows: 0, reds: 0, corners: 0, fouls: 0, homeWins: 0, awayWins: 0, draws: 0, goalless: 0 };
const goalHistogram = new Map<number, number>();
const split = { home: { goals: 0, xg: 0, fouls: 0, energy: 0 }, away: { goals: 0, xg: 0, fouls: 0, energy: 0 } };

for (let seed = 1; seed <= matches; seed++) {
  const { state, result } = simulateBotMatch(seed, undefined, swap, { mentality });
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
    const team = state.team(side);
    const onPitch = team.onPitch();
    split[side].goals += state.score[side];
    split[side].xg += s.xg;
    split[side].fouls += s.fouls;
    split[side].energy += onPitch.reduce((sum, fp) => sum + fp.player.energy, 0) / Math.max(1, onPitch.length);
  }
}

const per = (n: number) => (n / matches).toFixed(2);
console.log(`\n${matches} simulated matches (bot vs bot)${swap ? ', teams swapped' : ''}${fixed.length ? `, ${fixed.join(', ')}` : ''}\n`);
console.log(`Goals / match        ${per(totals.goals)}   (goalless ${((totals.goalless / matches) * 100).toFixed(1)}%)`);
console.log(`xG / match           ${per(totals.xg)}`);
console.log(`Shots / match        ${per(totals.shots)}   on target ${per(totals.onTarget)}`);
console.log(`Cards played / match ${per(totals.cards)}`);
console.log(`Fouls / match        ${per(totals.fouls)}   yellows ${per(totals.yellows)}   reds ${per(totals.reds)}`);
console.log(`Corners / match      ${per(totals.corners)}`);
console.log(`Results              home ${totals.homeWins}  draw ${totals.draws}  away ${totals.awayWins}`);
console.log('Goal distribution    ' + [...goalHistogram.entries()].sort((a, b) => a[0] - b[0]).map(([g, n]) => `${g}:${n}`).join('  '));
for (const side of ['home', 'away'] as const) {
  const t = split[side];
  console.log(`${side.padEnd(20)} goals ${per(t.goals)}   xG ${per(t.xg)}   fouls ${per(t.fouls)}   energy at FT ${per(t.energy)}`);
}
