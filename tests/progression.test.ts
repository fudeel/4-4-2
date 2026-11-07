import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClubService } from '../src/server/clubs/ClubService';
import { JsonFileStore } from '../src/server/data/JsonFileStore';
import { facilityQuote, trainingQuote, YOUTH_MATCHES } from '../src/shared/model/progression';
import { simulateBotMatch } from '../src/server/sim/BotMatchSimulator';

const files: string[] = [];
function path() { const p = join(tmpdir(), `442-progression-${randomUUID()}.json`); files.push(p); return p; }
function setup() { const clubs = new ClubService(path()); const club = clubs.create('owner', 'Training FC', 'TRN', '#2255cc'); return { clubs, club }; }
function finish(clubs: ClubService, clubId: string, id: string) {
  const summary = simulateBotMatch(42);
  // Use an authentic resolved match with the persistent club as its participant.
  const team = summary.state.team('home');
  Object.defineProperty(team, 'profile', { value: { ...team.profile, id: clubId } });
  clubs.recordMatch(id, summary);
  return summary;
}
afterEach(() => { for (const p of files.splice(0)) if (existsSync(p)) unlinkSync(p); });

describe('club development', () => {
  it('quotes and charges a facility once, with demand and experience prerequisites', () => {
    const { clubs, club } = setup();
    expect(facilityQuote(club, 'stadium').allowed).toBe(false);
    const quote = facilityQuote(club, 'youth');
    const next = clubs.upgrade('owner', 'youth');
    expect(next.youthLevel).toBe(1);
    expect(next.budget).toBe(club.budget - quote.cost);
    expect(next.ledger.at(-1)!.amount).toBe(-quote.cost);
    expect(() => clubs.upgrade('other', 'training')).toThrow('Create your club');
    expect(() => clubs.upgrade('owner', 'money' as never)).toThrow('Unknown facility');
    expect(clubs.findOwner('owner')!.budget).toBe(next.budget);
  });
  it('requires XP, applies the quoted skill gain and cannot exceed potential', () => {
    const { clubs, club } = setup();
    const player = club.squad.find(p => p.position === 'FWD')!;
    expect(() => clubs.train('owner', player.id, 'shooting')).toThrow('XP');
    clubs.store.update(db => { db.clubs[0]!.development[player.id]!.xp = 1000; });
    const before = clubs.findOwner('owner')!;
    const quote = trainingQuote(before, player.id, 'shooting');
    const after = clubs.train('owner', player.id, 'shooting');
    expect(after.squad.find(p => p.id === player.id)!.attributes.shooting).toBe(player.attributes.shooting + quote.gain);
    expect(after.budget).toBe(before.budget - quote.cost);
    expect(after.development[player.id]!.xp).toBe(1000 - quote.xpCost);
    clubs.store.update(db => { const c = db.clubs[0]!; c.squad.find(p => p.id === player.id)!.attributes.shooting = c.development[player.id]!.potential; });
    const balance = clubs.findOwner('owner')!.budget;
    expect(() => clubs.train('owner', player.id, 'shooting')).toThrow('potential');
    expect(clubs.findOwner('owner')!.budget).toBe(balance);
  });
  it('uses age, role and facilities to price and scale development', () => {
    const { club } = setup();
    const player = club.squad.find(p => p.position === 'FWD')!;
    club.development[player.id]!.xp = 1000;
    player.age = 19;
    const young = trainingQuote(club, player.id, 'shooting');
    player.age = 33;
    const older = trainingQuote(club, player.id, 'shooting');
    expect(young.gain).toBeGreaterThanOrEqual(older.gain);
    club.trainingLevel = 5;
    const coached = trainingQuote(club, player.id, 'shooting');
    expect(coached.cost).toBeLessThan(older.cost);
    expect(coached.gain).toBeGreaterThanOrEqual(older.gain);
  });
  it('settles results atomically once and grows supporters and club income', () => {
    const { clubs, club } = setup();
    const summary = finish(clubs, club.id, 'unique-result');
    const after = clubs.findOwner('owner')!;
    expect(after.budget).toBeGreaterThan(club.budget);
    expect(after.fans).toBeGreaterThan(50);
    expect(after.record.played).toBe(1);
    clubs.recordMatch('unique-result', summary);
    expect(clubs.findOwner('owner')).toEqual(after);
  });
  it('develops academy prospects through matches and promotes them into the owned squad', () => {
    const { clubs, club } = setup();
    clubs.upgrade('owner', 'youth');
    for (let i = 0; i < YOUTH_MATCHES(1); i++) finish(clubs, club.id, `youth-${i}`);
    const ready = clubs.findOwner('owner')!;
    expect(ready.prospects).toHaveLength(1);
    const prospect = ready.prospects[0]!;
    const promoted = clubs.promote('owner', prospect.player.id);
    expect(promoted.squad).toHaveLength(13);
    expect(promoted.team.playerIds).toContain(prospect.player.id);
    expect(promoted.development[prospect.player.id]!.potential).toBe(prospect.potential);
    expect(promoted.budget).toBe(ready.budget - prospect.cost);
    expect(new Set(promoted.squad.map(p => p.number)).size).toBe(13);
    expect(() => clubs.promote('owner', prospect.player.id)).toThrow('not found');
  });
  it('rolls back a failed mutation and preserves corrupt files for recovery', () => {
    const file = path();
    const store = new JsonFileStore(file, () => ({ budget: 100 }));
    expect(() => store.update(db => { db.budget = 0; throw new Error('declined'); })).toThrow('declined');
    expect(store.read().budget).toBe(100);
    expect(JSON.parse(readFileSync(file, 'utf8')).budget).toBe(100);
    writeFileSync(file, '{broken');
    expect(() => new JsonFileStore(file, () => ({ budget: 0 }))).toThrow('preserved');
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  });
});
