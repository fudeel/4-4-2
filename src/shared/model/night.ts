export interface NightMember { ownerId: string; username: string; clubId: string; clubName: string; shortName: string; color: string }
export interface NightFixture {
  id: string; round: number; home: string; away: string;
  status: 'pending' | 'playing' | 'finished'; roomCode: string | null;
  score: { home: number; away: number } | null; forfeit: boolean;
}
export interface NightView {
  code: string; name: string; hostId: string; phase: 'lobby' | 'playing' | 'finished';
  members: NightMember[]; fixtures: NightFixture[]; createdAt: number;
}
export interface NightStanding extends NightMember { played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; points: number; rank: number }

/** Circle scheduling: every pair meets once, with no player booked twice in a round. */
export function nightSchedule(owners: readonly string[]): NightFixture[] {
  const ring: (string | null)[] = [...owners];
  if (ring.length % 2) ring.push(null);
  const fixtures: NightFixture[] = [];
  for (let round = 1; round < ring.length; round++) {
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i], b = ring[ring.length - 1 - i];
      if (!a || !b) continue;
      const swap = i === 0 ? round % 2 === 0 : i % 2 === 0;
      fixtures.push({ id: `r${round}m${i + 1}`, round, home: swap ? b : a, away: swap ? a : b, status: 'pending', roomCode: null, score: null, forfeit: false });
    }
    ring.splice(1, 0, ring.pop()!);
  }
  return fixtures;
}
export function nightStandings(night: NightView): NightStanding[] {
  const rows = night.members.map(m => ({ ...m, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, rank: 0 }));
  for (const fixture of night.fixtures) {
    if (!fixture.score || fixture.status !== 'finished') continue;
    for (const side of ['home', 'away'] as const) {
      const row = rows.find(r => r.ownerId === fixture[side]);
      if (!row) continue;
      const gf = fixture.score[side], ga = fixture.score[side === 'home' ? 'away' : 'home'];
      row.played++; row.goalsFor += gf; row.goalsAgainst += ga;
      if (gf > ga) { row.wins++; row.points += 3; } else if (gf === ga) { row.draws++; row.points++; } else row.losses++;
    }
  }
  rows.sort((a, b) => b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor || a.clubName.localeCompare(b.clubName));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && r.points === prev.points && r.goalsFor - r.goalsAgainst === prev.goalsFor - prev.goalsAgainst && r.goalsFor === prev.goalsFor ? prev.rank : i + 1;
  });
  return rows;
}
