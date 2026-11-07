import { randomBytes } from 'node:crypto';
import { nightSchedule, nightStandings, type NightMember, type NightView } from '../../shared/model/night';
import type { AccountView } from '../../shared/model/account';
import { ApiError } from '../accounts/AccountService';
import { JsonFileStore } from '../data/JsonFileStore';
import type { MatchSummary, TeamSetup } from '../match/Match';
import type { RoomRegistry } from '../rooms/RoomRegistry';
import type { ClubService } from './ClubService';

interface NightRecord extends NightView { squads: Record<string, TeamSetup> }
export class NightService {
  readonly store: JsonFileStore<{ nights: NightRecord[] }>;
  constructor(path: string, private readonly clubs: ClubService, private readonly rooms: RoomRegistry) {
    this.store = new JsonFileStore(path, () => ({ nights: [] }));
    // Match rooms are transient. A server restart makes interrupted fixtures playable again.
    this.store.update(db => { for (const night of db.nights) for (const f of night.fixtures) if (f.status === 'playing') { f.status = 'pending'; f.roomCode = null; } });
    for (const night of this.store.read().nights) if (night.phase === 'finished' && night.fixtures.some(f => !f.forfeit)) this.clubs.awardNight(night.code, night.name, nightStandings(night));
  }
  current(ownerId: string): NightView | null {
    const night = [...this.store.read().nights].reverse().find(n => n.members.some(m => m.ownerId === ownerId));
    return night ? this.view(night) : null;
  }
  get(code: string, ownerId: string): NightView {
    const night = this.record(code);
    this.member(night, ownerId);
    return this.view(night);
  }
  create(account: AccountView, name: unknown): NightView {
    const active = this.store.read().nights.find(n => n.phase !== 'finished' && n.members.some(m => m.ownerId === account.id));
    if (active) throw new ApiError(409, `You already have a friends night: ${active.code}. Reopen it or leave its lobby first.`);
    if (typeof name !== 'string' || !/^[\p{L}\p{N} .'’-]{3,36}$/u.test(name.trim())) throw new ApiError(400, 'Name your night with 3–36 letters, numbers, spaces, apostrophes or hyphens.');
    const member = this.makeMember(account);
    let code: string;
    do { code = Array.from(randomBytes(5), n => 'ABCDEFGHJKMNPQRSTUVWXYZ'[n % 22]).join(''); } while (this.store.read().nights.some(n => n.code === code));
    const night: NightRecord = { code, name: name.trim(), hostId: account.id, phase: 'lobby', members: [member], fixtures: [], squads: {}, createdAt: Date.now() };
    this.store.update(db => db.nights.push(night));
    return this.view(night);
  }
  join(account: AccountView, code: string): NightView {
    const night = this.record(code);
    if (night.members.some(m => m.ownerId === account.id)) return this.view(night);
    if (night.phase !== 'lobby') throw new ApiError(409, 'This night has already started.');
    if (night.members.length >= 8) throw new ApiError(409, 'This night is full (8 managers).');
    const active = this.store.read().nights.find(n => n.phase !== 'finished' && n.members.some(m => m.ownerId === account.id));
    if (active) throw new ApiError(409, `Leave night ${active.code} before joining another.`);
    const member = this.makeMember(account);
    this.store.update(db => db.nights.find(n => n.code === night.code)!.members.push(member));
    return this.get(night.code, account.id);
  }
  leave(ownerId: string, code: string): void {
    const night = this.record(code); this.member(night, ownerId);
    if (night.phase !== 'lobby') throw new ApiError(409, 'The schedule is locked. You can concede your own remaining fixtures or return to your club.');
    this.store.update(db => {
      const n = db.nights.find(n => n.code === night.code)!;
      n.members = n.members.filter(m => m.ownerId !== ownerId);
      if (!n.members.length) n.phase = 'finished';
      else if (n.hostId === ownerId) n.hostId = n.members[0]!.ownerId;
    });
  }
  start(ownerId: string, code: string): NightView {
    const night = this.record(code);
    if (night.hostId !== ownerId) throw new ApiError(403, 'Only the host can start the night.');
    if (night.phase !== 'lobby') throw new ApiError(409, 'This night already started.');
    if (night.members.length < 2) throw new ApiError(400, 'Invite at least one friend first.');
    if (night.members.some(m => this.rooms.isClubBusy(m.ownerId))) throw new ApiError(409, 'All managers must leave their exhibitions before the night starts.');
    const squads = Object.fromEntries(night.members.map(m => { const c = this.clubs.findOwner(m.ownerId)!; return [m.ownerId, { team: c.team, squad: c.squad, lineup: c.lineup }]; }));
    this.store.update(db => { const n = db.nights.find(n => n.code === night.code)!; n.phase = 'playing'; n.squads = squads; n.fixtures = nightSchedule(n.members.map(m => m.ownerId)); });
    return this.get(code, ownerId);
  }
  play(ownerId: string, code: string, fixtureId: string): { night: NightView; roomCode: string } {
    const night = this.record(code); this.member(night, ownerId);
    const fixture = night.fixtures.find(f => f.id === fixtureId);
    if (!fixture || (fixture.home !== ownerId && fixture.away !== ownerId)) throw new ApiError(403, 'Only the two scheduled managers can open this fixture.');
    if (night.phase !== 'playing' || fixture.status === 'finished') throw new ApiError(409, 'This fixture is already finished.');
    if (night.fixtures.some(f => f.round < fixture.round && f.status !== 'finished')) throw new ApiError(409, 'Finish the previous round first.');
    if (fixture.roomCode) {
      try { this.rooms.find(fixture.roomCode); return { night: this.view(night), roomCode: fixture.roomCode }; } catch { /* abandoned room: create a fresh one */ }
    }
    if ([fixture.home, fixture.away].some(id => this.rooms.isClubBusy(id))) throw new ApiError(409, 'Both managers must leave their other exhibition first.');
    const home = night.members.find(m => m.ownerId === fixture.home)!, away = night.members.find(m => m.ownerId === fixture.away)!;
    const room = this.rooms.createFixture(night.squads[fixture.home]!, night.squads[fixture.away]!, [home, away], code, summary => this.finish(code, fixtureId, summary));
    this.store.update(db => { const f = db.nights.find(n => n.code === night.code)!.fixtures.find(f => f.id === fixtureId)!; f.status = 'playing'; f.roomCode = room.code; });
    return { night: this.get(code, ownerId), roomCode: room.code };
  }
  concede(ownerId: string, code: string, fixtureId: string): NightView {
    const night = this.record(code); this.member(night, ownerId);
    const fixture = night.fixtures.find(f => f.id === fixtureId);
    if (!fixture || (fixture.home !== ownerId && fixture.away !== ownerId)) throw new ApiError(403, 'You can only concede your own fixture.');
    if (night.phase !== 'playing' || fixture.status === 'finished') throw new ApiError(409, 'This fixture is finished.');
    if (fixture.roomCode) this.rooms.cancel(fixture.roomCode);
    this.store.update(db => {
      const f = db.nights.find(n => n.code === night.code)!.fixtures.find(f => f.id === fixtureId)!;
      f.status = 'finished'; f.forfeit = true; f.score = { home: fixture.home === ownerId ? 0 : 1, away: fixture.away === ownerId ? 0 : 1 };
    });
    this.complete(code);
    return this.get(code, ownerId);
  }
  private finish(code: string, fixtureId: string, { state }: MatchSummary): void {
    const night = this.record(code), fixture = night.fixtures.find(f => f.id === fixtureId);
    if (!fixture || fixture.status === 'finished' || state.phase !== 'fulltime') return;
    if (state.team('home').profile.id !== night.squads[fixture.home]!.team.id || state.team('away').profile.id !== night.squads[fixture.away]!.team.id) return;
    this.store.update(db => { const f = db.nights.find(n => n.code === night.code)!.fixtures.find(f => f.id === fixtureId)!; f.status = 'finished'; f.score = { ...state.score }; });
    this.complete(code);
  }
  private complete(code: string): void {
    const night = this.record(code);
    if (!night.fixtures.length || night.fixtures.some(f => f.status !== 'finished')) return;
    this.store.update(db => { db.nights.find(n => n.code === night.code)!.phase = 'finished'; });
    if (night.fixtures.some(f => !f.forfeit)) this.clubs.awardNight(code, night.name, nightStandings(night));
  }
  private makeMember(account: AccountView): NightMember {
    const club = this.clubs.findOwner(account.id);
    if (!club) throw new ApiError(400, 'Create your club first.');
    return { ownerId: account.id, username: account.username, clubId: club.id, clubName: club.team.name, shortName: club.team.shortName, color: club.team.primaryColor };
  }
  private record(code: string): NightRecord {
    const night = this.store.read().nights.find(n => n.code === code.toUpperCase());
    if (!night) throw new ApiError(404, 'Friends night not found. Check the five-letter code.');
    return night;
  }
  private member(n: NightRecord, ownerId: string): void { if (!n.members.some(m => m.ownerId === ownerId)) throw new ApiError(403, 'Join this friends night first.'); }
  private view(n: NightRecord): NightView { const { squads: _squads, ...view } = structuredClone(n); return view; }
}
