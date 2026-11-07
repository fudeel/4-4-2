import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nightSchedule, nightStandings } from '../src/shared/model/night';
import { DEFAULT_RULES } from '../src/shared/rules';
import { ClubService } from '../src/server/clubs/ClubService';
import { NightService } from '../src/server/clubs/NightService';
import { SeededRng } from '../src/server/core/Random';
import { ManualScheduler } from '../src/server/core/Scheduler';
import { createJsonDatabase } from '../src/server/data/JsonDatabase';
import { ClientSession } from '../src/server/net/ClientSession';
import { RoomRegistry } from '../src/server/rooms/RoomRegistry';

const files: string[] = [];
const path = () => { const p = join(tmpdir(), `442-night-${randomUUID()}.json`); files.push(p); return p; };
function setup(count = 2) {
  const clubs = new ClubService(path());
  const accounts = Array.from({ length: count }, (_, i) => ({ id: `owner-${i}`, username: `Manager${String.fromCharCode(65 + i)}` }));
  accounts.forEach((a, i) => clubs.create(a.id, `Club ${i}`, `C${String.fromCharCode(65 + i)}`, '#cc3355'));
  const db = createJsonDatabase(path()), scheduler = new ManualScheduler();
  let seed = 1;
  const registry = new RoomRegistry({ db, scheduler, rules: DEFAULT_RULES, createRng: () => new SeededRng(seed++), onFinished: (id, result) => clubs.recordMatch(id, result) }, () => {
    const [home, away] = db.teams.findAll();
    return { home: { team: home!, squad: db.players.findByTeam(home!.id) }, away: { team: away!, squad: db.players.findByTeam(away!.id) } };
  });
  const file = path(), nights = new NightService(file, clubs, registry);
  const initial = nights.create(accounts[0]!, 'Friday night');
  accounts.slice(1).forEach(a => nights.join(a, initial.code));
  return { clubs, accounts, registry, scheduler, nights, file, code: initial.code };
}
afterEach(() => { for (const f of files.splice(0)) if (existsSync(f)) unlinkSync(f); });

describe('friends night', () => {
  it('schedules every pair once for 2–8 managers without double bookings', () => {
    for (let n = 2; n <= 8; n++) {
      const owners = Array.from({ length: n }, (_, i) => String(i));
      const fixtures = nightSchedule(owners);
      expect(fixtures).toHaveLength(n * (n - 1) / 2);
      expect(new Set(fixtures.map(f => [f.home, f.away].sort().join('-'))).size).toBe(fixtures.length);
      for (const round of new Set(fixtures.map(f => f.round))) {
        const booked = fixtures.filter(f => f.round === round).flatMap(f => [f.home, f.away]);
        expect(new Set(booked).size).toBe(booked.length);
      }
      for (const owner of owners) expect(Math.abs(fixtures.filter(f => f.home === owner).length - fixtures.filter(f => f.away === owner).length)).toBeLessThanOrEqual(2);
    }
  });
  it('enforces host/member permissions and seals squads on start', () => {
    const f = setup();
    expect(() => f.nights.start(f.accounts[1]!.id, f.code)).toThrow('Only the host');
    expect(() => f.nights.get(f.code, 'stranger')).toThrow('Join');
    const night = f.nights.start(f.accounts[0]!.id, f.code);
    expect(night.fixtures).toHaveLength(1);
    expect(night).not.toHaveProperty('squads');
    expect(() => f.nights.join({ id: 'outsider', username: 'Outsider' }, f.code)).toThrow('already started');
  });
  it('reserves the right seats even when the away manager arrives first and settles real results once', () => {
    const f = setup();
    const night = f.nights.start(f.accounts[0]!.id, f.code), fixture = night.fixtures[0]!;
    const opened = f.nights.play(fixture.home, f.code, fixture.id);
    expect(f.nights.play(fixture.away, f.code, fixture.id).roomCode).toBe(opened.roomCode);
    const room = f.registry.find(opened.roomCode);
    expect(() => room.join(new ClientSession('outsider', { send: () => {} }))).toThrow('reserved');
    const away = new ClientSession(fixture.away, { send: () => {} });
    const home = new ClientSession(fixture.home, { send: () => {} });
    expect(room.join(away)).toBe('away'); expect(room.join(home)).toBe('home');
    room.handle(home.clientId, { type: 'setReady', ready: true }); room.handle(away.clientId, { type: 'setReady', ready: true });
    f.scheduler.runAll();
    const finished = f.nights.get(f.code, fixture.home);
    expect(finished.phase).toBe('finished');
    expect(finished.fixtures[0]!.score).toBeTruthy();
    const standings = nightStandings(finished);
    expect(standings.every(r => r.played === 1)).toBe(true);
    expect(f.clubs.findOwner(fixture.home)!.record.played).toBe(1);
    expect(f.clubs.findOwner(standings[0]!.ownerId)!.trophies[0]!.rank).toBe(1);
    const budget = f.clubs.findOwner(standings[0]!.ownerId)!.budget;
    new NightService(f.file, f.clubs, f.registry);
    expect(f.clubs.findOwner(standings[0]!.ownerId)!.budget).toBe(budget);
    room.dispose();
  });
  it('blocks later rounds and prevents managers from conceding someone else’s game', () => {
    const f = setup(3), night = f.nights.start(f.accounts[0]!.id, f.code);
    const later = night.fixtures.find(m => m.round === 2)!;
    expect(() => f.nights.play(later.home, f.code, later.id)).toThrow('previous round');
    const first = night.fixtures[0]!, outsider = f.accounts.find(a => ![first.home, first.away].includes(a.id))!;
    expect(() => f.nights.concede(outsider.id, f.code, first.id)).toThrow('only concede');
  });
  it('scores concessions without minting match income or free trophies', () => {
    const f = setup(), night = f.nights.start(f.accounts[0]!.id, f.code), match = night.fixtures[0]!;
    const done = f.nights.concede(match.home, f.code, match.id);
    expect(done.phase).toBe('finished');
    expect(nightStandings(done)[0]!.ownerId).toBe(match.away);
    for (const a of f.accounts) { expect(f.clubs.findOwner(a.id)!.budget).toBe(100000); expect(f.clubs.findOwner(a.id)!.trophies).toHaveLength(0); }
  });
  it('recovers an interrupted fixture as pending after a server restart', () => {
    const f = setup(), night = f.nights.start(f.accounts[0]!.id, f.code), fixture = night.fixtures[0]!;
    const opened = f.nights.play(fixture.home, f.code, fixture.id);
    f.registry.cancel(opened.roomCode);
    const resumed = new NightService(f.file, f.clubs, f.registry).get(f.code, fixture.home);
    expect(resumed.fixtures[0]!.status).toBe('pending');
    expect(resumed.fixtures[0]!.roomCode).toBeNull();
  });
  it('passes the host role to a remaining manager when the host leaves the lobby', () => {
    const f = setup(); f.nights.leave(f.accounts[0]!.id, f.code);
    expect(f.nights.get(f.code, f.accounts[1]!.id).hostId).toBe(f.accounts[1]!.id);
  });
});
