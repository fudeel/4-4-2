import { randomBytes } from 'node:crypto';
import { STARTING_BUDGET, type ClubView } from '../../shared/model/club';
import { LineupBuilder, LineupValidator, type Lineup } from '../../shared/model/lineup';
import { ApiError } from '../accounts/AccountService';
import { JsonFileStore } from '../data/JsonFileStore';
import { SEED_PLAYERS, SEED_TEAMS } from '../data/seed';
import type { MatchSummary } from '../match/Match';

export interface ClubDatabase { clubs: ClubView[]; settled: string[] }
export class ClubService {
  readonly store: JsonFileStore<ClubDatabase>;
  constructor(path: string) {
    this.store = new JsonFileStore(path, () => ({ clubs: [], settled: [] }));
    this.store.update(db => { db.settled ??= []; for (const club of db.clubs) club.history ??= []; });
  }
  findOwner(ownerId: string): ClubView | null {
    const club = this.store.read().clubs.find(c => c.ownerId === ownerId);
    return club ? structuredClone(club) : null;
  }
  findTeam(id: string): ClubView | null {
    const club = this.store.read().clubs.find(c => c.id === id);
    return club ? structuredClone(club) : null;
  }
  create(ownerId: string, name: unknown, shortName: unknown, color: unknown): ClubView {
    if (this.findOwner(ownerId)) throw new ApiError(409, 'You already have a club.');
    if (typeof name !== 'string' || !/^[\p{L}\p{N} .'’-]{3,28}$/u.test(name.trim())) throw new ApiError(400, 'Club name must be 3–28 letters, numbers, spaces, apostrophes or hyphens.');
    if (typeof shortName !== 'string' || !/^[A-Za-z]{2,4}$/.test(shortName)) throw new ApiError(400, 'Use 2–4 letters for your club abbreviation.');
    if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) throw new ApiError(400, 'Choose a valid club colour.');
    if (this.store.read().clubs.some(c => c.team.name.toLowerCase() === name.trim().toLowerCase())) throw new ApiError(409, 'That club name is taken.');
    const id = `club-${randomBytes(6).toString('hex')}`;
    const squad = SEED_PLAYERS.filter(p => p.teamId === SEED_TEAMS[0]!.id).map((base, i) => {
      const attributes = structuredClone(base.attributes);
      for (const key of Object.keys(attributes) as (keyof typeof attributes)[]) attributes[key] = Math.max(8, Math.round(attributes[key] * 0.7));
      return { ...structuredClone(base), id: `${id}-${i + 1}`, teamId: id, age: 20 + i % 10, trait: null, attributes };
    });
    const createdAt = Date.now();
    const club: ClubView = {
      id, ownerId, team: { id, name: name.trim(), shortName: shortName.toUpperCase(), primaryColor: color, secondaryColor: '#17251e', goalkeeperColor: '#e7b748', playerIds: squad.map(p => p.id) },
      squad, lineup: LineupBuilder.best('2-2-1', squad), budget: STARTING_BUDGET,
      stadium: { name: `${name.trim()} Ground`, level: 1 }, youthLevel: 0, trainingLevel: 1,
      fans: 50, reputation: 1, morale: 70, record: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }, form: [],
      development: Object.fromEntries(squad.map((p, i) => [p.id, { xp: 0, potential: 74 + i % 10, sessions: 0 }])),
      ledger: [{ id: `founding-${id}`, at: createdAt, label: 'Founding grant', amount: STARTING_BUDGET }], history: [], createdAt,
    };
    this.store.update(db => db.clubs.push(club));
    return structuredClone(club);
  }

  recordMatch(id: string, { state }: MatchSummary): void {
    if (this.store.read().settled.includes(id)) return;
    this.store.update(db => {
      if (db.settled.includes(id)) return;
      db.settled.push(id);
      db.settled = db.settled.slice(-5000);
      for (const side of ['home', 'away'] as const) {
        const club = db.clubs.find(c => c.id === state.team(side).profile.id);
        if (!club) continue;
        const other = side === 'home' ? 'away' : 'home';
        const goalsFor = state.score[side], goalsAgainst = state.score[other];
        const result: 'W' | 'D' | 'L' = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
        club.record.played++;
        club.record[result === 'W' ? 'wins' : result === 'D' ? 'draws' : 'losses']++;
        club.record.goalsFor += goalsFor;
        club.record.goalsAgainst += goalsAgainst;
        club.form = [...club.form, result].slice(-5);
        club.history = [...club.history, { id, at: Date.now(), opponent: state.team(other).profile.name, goalsFor, goalsAgainst, result }].slice(-50);
      }
    });
  }

  setLineup(ownerId: string, lineup: Lineup): void {
    const club = this.findOwner(ownerId);
    if (!club) throw new ApiError(404, 'Club not found.');
    const result = new LineupValidator().validate(lineup, { squad: club.squad, requiredPlayers: 6, unavailable: new Set() });
    if (!result.ok) throw new ApiError(400, result.error);
    this.store.update(db => { db.clubs.find(c => c.id === club.id)!.lineup = structuredClone(lineup); });
  }
}
