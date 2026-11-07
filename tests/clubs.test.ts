import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClubService } from '../src/server/clubs/ClubService';
import { LineupValidator } from '../src/shared/model/lineup';

const files: string[] = [];
function setup() { const path = join(tmpdir(), `442-clubs-${randomUUID()}.json`); files.push(path); return { clubs: new ClubService(path), path }; }
afterEach(() => { for (const f of files.splice(0)) if (existsSync(f)) unlinkSync(f); });
describe('club creation', () => {
  it('gives every manager the promised starter resources and a valid squad', () => {
    const { clubs, path } = setup();
    const club = clubs.create('owner', 'Friday FC', 'FFC', '#d43d4f');
    expect(club.budget).toBe(100000);
    expect(club.fans).toBe(50);
    expect(club.stadium.level).toBe(1);
    expect(club.youthLevel).toBe(0);
    expect(club.squad).toHaveLength(12);
    expect(club.squad.filter(p => p.position === 'GK')).toHaveLength(2);
    expect(new Set(club.squad.map(p => p.id)).size).toBe(12);
    expect(new LineupValidator().validate(club.lineup, { squad: club.squad, requiredPlayers: 6, unavailable: new Set() }).ok).toBe(true);
    expect(new ClubService(path).findOwner('owner')).toEqual(club);
    club.budget = 0;
    expect(clubs.findOwner('owner')!.budget).toBe(100000);
  });
  it('prevents duplicate clubs and gives different managers equal, isolated squads', () => {
    const { clubs } = setup();
    const a = clubs.create('a', 'First FC', 'ONE', '#ffffff');
    expect(() => clubs.create('a', 'New FC', 'NEW', '#ffffff')).toThrow('already');
    expect(() => clubs.create('b', 'first fc', 'TWO', '#ffffff')).toThrow('taken');
    const b = clubs.create('b', 'Second FC', 'TWO', '#000000');
    expect(a.squad.map(p => p.attributes)).toEqual(b.squad.map(p => p.attributes));
    expect(a.squad.some(p => b.squad.some(q => p.id === q.id))).toBe(false);
    expect(clubs.findOwner('unknown')).toBeNull();
  });
  it('validates club names, abbreviations and colours on the server', () => {
    const { clubs } = setup();
    expect(() => clubs.create('a', '<img>', 'FC', '#ffffff')).toThrow();
    expect(() => clubs.create('a', 'Valid FC', 'F1', '#ffffff')).toThrow();
    expect(() => clubs.create('a', 'Valid FC', 'FC', 'red')).toThrow();
    expect(clubs.store.read().clubs).toHaveLength(0);
  });
});
