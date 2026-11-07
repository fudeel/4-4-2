import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_EXHIBITION } from '../src/shared/model/exhibition';
import type { MatchView, Side } from '../src/shared/model/match';
import { overallRating } from '../src/shared/model/player';
import type { ServerMessage } from '../src/shared/protocol';
import { DEFAULT_RULES } from '../src/shared/rules';
import { ClubService } from '../src/server/clubs/ClubService';
import { SeededRng } from '../src/server/core/Random';
import { ManualScheduler } from '../src/server/core/Scheduler';
import { createJsonDatabase } from '../src/server/data/JsonDatabase';
import { ClientSession } from '../src/server/net/ClientSession';
import { RoomRegistry } from '../src/server/rooms/RoomRegistry';
import { parseClientMessage } from '../src/server/net/MessageParser';
import { exhibitionTeam } from '../src/server/rooms/Exhibition';

const files: string[] = [];
export function fixture() {
  const file = () => { const p = join(tmpdir(), `442-exhibition-${randomUUID()}.json`); files.push(p); return p; };
  const clubs = new ClubService(file());
  const a = clubs.create('alice', 'Friday FC', 'FFC', '#cc3344');
  const b = clubs.create('bob', 'Saturday FC', 'SFC', '#3355cc');
  const db = createJsonDatabase(file());
  const scheduler = new ManualScheduler();
  let seed = 1;
  const teams = () => Object.fromEntries((['home', 'away'] as const).map((side, i) => {
    const team = db.teams.findAll()[i]!;
    return [side, { team, squad: db.players.findByTeam(team.id) }];
  })) as Record<Side, { team: typeof a.team; squad: typeof a.squad }>;
  const registry = new RoomRegistry({ db, scheduler, rules: DEFAULT_RULES, createRng: () => new SeededRng(seed++), onFinished: (id, summary) => clubs.recordMatch(id, summary), onLineup: (owner, lineup) => clubs.setLineup(owner, lineup) }, teams);
  return { clubs, a, b, db, scheduler, registry };
}
function client(id: string) {
  const inbox: ServerMessage[] = [];
  const session = new ClientSession(id, { send: m => inbox.push(m) });
  session.name = id;
  return { session, latest: () => (inbox.filter(m => m.type === 'state').at(-1) as { view: MatchView }).view };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => { for (const f of files.splice(0)) if (existsSync(f)) unlinkSync(f); });

describe('persistent club exhibitions', () => {
  it('hosts both owned squads, balances only the match snapshots, and reconnects the same seat', async () => {
    const f = fixture();
    const setup = (club: typeof f.a) => ({ team: club.team, squad: club.squad, lineup: club.lineup });
    const room = f.registry.create('human', setup(f.a), DEFAULT_EXHIBITION);
    const a = client('alice'), b = client('bob');
    room.join(a.session, setup(f.a)); room.join(b.session, setup(f.b)); await flush();
    const view = a.latest();
    expect(view.teams.home.team.id).toBe(f.a.id);
    expect(view.teams.away.team.id).toBe(f.b.id);
    expect(view.teams.away.squad.map(p => p.id)).toEqual(f.b.squad.map(p => p.id));
    expect(view.teams.home.squad[0]!.attributes).not.toEqual(f.a.squad[0]!.attributes);
    expect(f.clubs.findOwner('alice')!.squad[0]!.attributes).toEqual(f.a.squad[0]!.attributes);
    room.disconnected(a.session);
    const again = client('alice'); expect(room.join(again.session, setup(f.a))).toBe('home');
    await flush(); expect(again.latest().you).toBe('home');
    room.dispose();
  });
  it('completes quick AI exhibitions and records club history once', async () => {
    const f = fixture();
    const room = f.registry.create('bot', { team: f.a.team, squad: f.a.squad }, DEFAULT_EXHIBITION);
    const a = client('alice'); room.join(a.session); room.handle('alice', { type: 'setReady', ready: true });
    f.scheduler.runAll(); await flush();
    expect(a.latest().phase).toBe('fulltime');
    expect(a.latest().totalTurns).toBe(6);
    expect(f.clubs.findOwner('alice')!.record.played).toBe(1);
    expect(f.clubs.findOwner('alice')!.history).toHaveLength(1);
    expect(f.clubs.findOwner('bob')!.record.played).toBe(0);
    expect(f.db.matches.recent(10)).toHaveLength(1);
    room.handle('alice', { type: 'requestRematch' }); await flush();
    expect(f.clubs.findOwner('alice')!.record.played).toBe(1);
    room.dispose();
  });
  it('normalizes team strength without mutating the persistent players', () => {
    const f = fixture();
    const copy = exhibitionTeam({ team: f.a.team, squad: f.a.squad }, true);
    const avg = copy.squad.reduce((n, p) => n + overallRating(p), 0) / 12;
    expect(avg).toBeGreaterThan(59); expect(avg).toBeLessThan(61);
    expect(copy.squad[0]).not.toBe(f.a.squad[0]);
  });
  it('rejects invalid exhibition settings rather than trusting socket data', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'createRoom', opponent: 'bot', options: { pace: 'instant', difficulty: 'balanced', fairPlay: true } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'createRoom', opponent: 'human', options: DEFAULT_EXHIBITION }))).toBeTruthy();
  });
});
