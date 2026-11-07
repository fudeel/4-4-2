import { randomBytes } from 'node:crypto';
import { STARTING_BUDGET, type ClubView } from '../../shared/model/club';
import { LineupBuilder, LineupValidator, type Lineup } from '../../shared/model/lineup';
import { ApiError } from '../accounts/AccountService';
import { JsonFileStore } from '../data/JsonFileStore';
import { SEED_PLAYERS, SEED_TEAMS } from '../data/seed';
import type { MatchSummary } from '../match/Match';
import { CORE_SKILLS, expectedAttendance, FACILITIES, facilityQuote, MAX_SQUAD, trainingQuote, YOUTH_MATCHES, type Facility } from '../../shared/model/progression';
import { overallRating, type AttributeKey, type PlayerProfile, type Position } from '../../shared/model/player';
import { otherSide } from '../../shared/model/match';
import type { NightStanding } from '../../shared/model/night';

export interface ClubDatabase { clubs: ClubView[]; settled: string[] }
export class ClubService {
  readonly store: JsonFileStore<ClubDatabase>;
  constructor(path: string) {
    this.store = new JsonFileStore(path, () => ({ clubs: [], settled: [] }));
    this.store.update(db => { db.settled ??= []; for (const club of db.clubs) { club.history ??= []; club.prospects ??= []; club.youthProgress ??= 0; club.trophies ??= []; } });
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
      ledger: [{ id: `founding-${id}`, at: createdAt, label: 'Founding grant', amount: STARTING_BUDGET }], history: [], prospects: [], youthProgress: 0, trophies: [], createdAt,
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
        const recent = club.history.filter(m => m.at > Date.now() - 86400000);
        const repeats = recent.filter(m => m.opponent === state.team(otherSide(side)).profile.name).length;
        const factor = (recent.length >= 12 ? 0.25 : 1) * Math.max(0.25, Math.pow(0.75, Math.max(0, repeats - 2)));
        const gate = side === 'home' ? expectedAttendance(club) * 10 : 0;
        const income = Math.round((1800 + (result === 'W' ? 1000 : result === 'D' ? 500 : 250) + gate + club.reputation * 15) * factor);
        club.budget += income;
        club.ledger.push({ id: `income-${id}`, at: Date.now(), label: `Exhibition ${result} · appearance, performance${gate ? ' & gate' : ''}${factor < 1 ? ' · repeat-match reduction' : ''}`, amount: income });
        club.ledger = club.ledger.slice(-100);
        club.morale = Math.max(35, Math.min(95, club.morale + (result === 'W' ? 4 : result === 'D' ? 1 : -3)));
        club.fans += Math.round((result === 'W' ? 12 : result === 'D' ? 7 : 4) * (1 + club.reputation / 100) * factor);
        club.reputation = Math.min(100, club.reputation + (result === 'W' ? 1 : 0.25));
        for (const player of club.squad) {
          const mp = state.team(side).players.get(player.id);
          const xp = mp?.appeared ? 12 + Math.round(mp.rating * 2) + club.trainingLevel * 2 + (result === 'W' ? 4 : 0) : 6 + club.trainingLevel;
          club.development[player.id]!.xp += Math.max(2, Math.round(xp * Math.max(0.5, factor)));
        }
        if (club.youthLevel && club.prospects.length < 3) {
          club.youthProgress++;
          if (club.youthProgress >= YOUTH_MATCHES(club.youthLevel)) { club.youthProgress = 0; this.addProspect(club); }
        }
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

  upgrade(ownerId: string, facility: Facility): ClubView {
    if (!FACILITIES.includes(facility)) throw new ApiError(400, 'Unknown facility.');
    return this.change(ownerId, club => {
      const quote = facilityQuote(club, facility);
      if (!quote.allowed) throw new ApiError(400, quote.reason);
      this.spend(club, quote.cost, `${facility} expansion`);
      if (facility === 'stadium') club.stadium.level++;
      else if (facility === 'training') club.trainingLevel++;
      else club.youthLevel++;
    });
  }

  train(ownerId: string, playerId: string, attribute: AttributeKey): ClubView {
    return this.change(ownerId, club => {
      const quote = trainingQuote(club, playerId, attribute);
      if (!quote.allowed) throw new ApiError(400, quote.reason);
      const player = club.squad.find(p => p.id === playerId)!;
      this.spend(club, quote.cost, `${player.name} · ${attribute} +${quote.gain}`);
      player.attributes[attribute] += quote.gain;
      club.development[playerId]!.xp -= quote.xpCost;
      club.development[playerId]!.sessions++;
    });
  }

  promote(ownerId: string, prospectId: string): ClubView {
    return this.change(ownerId, club => {
      const prospect = club.prospects.find(p => p.player.id === prospectId);
      if (!prospect) throw new ApiError(404, 'Prospect not found.');
      if (club.squad.length >= MAX_SQUAD) throw new ApiError(400, 'Your squad is full (18 players).');
      this.spend(club, prospect.cost, `${prospect.player.name} · academy promotion`);
      const occupied = new Set(club.squad.map(p => p.number));
      prospect.player.number = Array.from({ length: 99 }, (_, i) => i + 1).find(n => !occupied.has(n))!;
      club.squad.push(prospect.player);
      club.team.playerIds.push(prospect.player.id);
      club.development[prospect.player.id] = { xp: 0, potential: prospect.potential, sessions: 0 };
      club.prospects = club.prospects.filter(p => p.player.id !== prospectId);
    });
  }

  release(ownerId: string, playerId: string): ClubView {
    return this.change(ownerId, club => {
      const player = club.squad.find(p => p.id === playerId);
      if (!player) throw new ApiError(404, 'Player not found.');
      if (club.lineup.slots.includes(playerId)) throw new ApiError(400, 'Move this player to the bench first.');
      if (club.squad.length <= 12) throw new ApiError(400, 'Keep at least 12 players in your squad. Promote a prospect before releasing a player.');
      if (player.position === 'GK' && club.squad.filter(p => p.position === 'GK').length <= 2) throw new ApiError(400, 'Keep two goalkeepers.');
      const fee = Math.round(overallRating(player) * 25);
      club.budget += fee;
      club.ledger = [...club.ledger, { id: randomBytes(8).toString('hex'), at: Date.now(), label: `${player.name} · release compensation`, amount: fee }].slice(-100);
      club.squad = club.squad.filter(p => p.id !== playerId);
      club.team.playerIds = club.team.playerIds.filter(id => id !== playerId);
      delete club.development[playerId];
    });
  }

  awardNight(code: string, name: string, standings: NightStanding[]): void {
    const id = `night-prize-${code}`;
    if (this.store.read().settled.includes(id)) return;
    this.store.update(db => {
      if (db.settled.includes(id)) return;
      db.settled.push(id);
      for (const row of standings) {
        const club = db.clubs.find(c => c.ownerId === row.ownerId);
        if (!club) continue;
        const prize = row.rank === 1 ? 10000 : row.rank === 2 ? 5000 : row.rank === 3 ? 2500 : 1000;
        club.budget += prize;
        club.ledger = [...club.ledger, { id, at: Date.now(), label: `${name} · place ${row.rank} prize`, amount: prize }].slice(-100);
        if (row.rank <= 3) club.trophies = [...club.trophies, { nightCode: code, name, rank: row.rank, at: Date.now() }].slice(-50);
      }
    });
  }

  private change(ownerId: string, mutate: (club: ClubView) => void): ClubView {
    this.store.update(db => {
      const club = db.clubs.find(c => c.ownerId === ownerId);
      if (!club) throw new ApiError(404, 'Create your club first.');
      mutate(club);
    });
    return this.findOwner(ownerId)!;
  }
  private spend(club: ClubView, cost: number, label: string): void {
    if (club.budget < cost) throw new ApiError(400, 'Not enough credits.');
    club.budget -= cost;
    club.ledger.push({ id: randomBytes(8).toString('hex'), at: Date.now(), label, amount: -cost });
    club.ledger = club.ledger.slice(-100);
  }
  private addProspect(club: ClubView): void {
    const positions: Position[] = ['DEF', 'MID', 'FWD'];
    const targets = { GK: 2, DEF: 3, MID: 4, FWD: 3 };
    const position = positions.sort((a, b) => club.squad.filter(p => p.position === a).length / targets[a] - club.squad.filter(p => p.position === b).length / targets[b])[0]!;
    const id = `${club.id}-${randomBytes(4).toString('hex')}`;
    const potential = Math.min(94, 72 + club.youthLevel * 3 + Math.floor(club.reputation / 15) + randomBytes(1)[0]! % 5);
    const base = 36 + club.youthLevel * 3;
    const first = ['Leo', 'Samir', 'Nico', 'Alex', 'Rafi', 'Milo', 'Luca', 'Enzo'];
    const last = ['Costa', 'Moretti', 'Silva', 'Marin', 'Santos', 'De Luca', 'Andersen', 'Vega'];
    const rand = randomBytes(3);
    const attributes = Object.fromEntries(['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'goalkeeping', 'stamina'].map(skill => [skill, skill === 'goalkeeping' ? 10 : base + (CORE_SKILLS[position].includes(skill as AttributeKey) ? 12 : 0)])) as unknown as PlayerProfile['attributes'];
    const player: PlayerProfile = { id, teamId: club.id, number: 0, name: `${first[rand[0]! % first.length]} ${last[rand[1]! % last.length]}`, position, age: 17 + rand[2]! % 3, nationality: 'ITA', attributes, trait: null };
    club.prospects.push({ player, potential, cost: Math.round((6500 + (potential - 70) * 300) * (1 - club.youthLevel * 0.06)) });
  }
}
