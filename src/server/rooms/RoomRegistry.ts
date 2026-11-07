import type { Side } from '../../shared/model/match';
import { ROOM_CODE_LENGTH, type OpponentKind } from '../../shared/protocol';
import { GameError } from '../core/GameError';
import type { TeamSetup } from '../match/Match';
import { Room, type RoomDependencies } from './Room';
import { DEFAULT_EXHIBITION, type ExhibitionOptions } from '../../shared/model/exhibition';
import { exhibitionRules, exhibitionTeam } from './Exhibition';
import { overallRating } from '../../shared/model/player';

/** No 0/O or 1/I/L: codes are read aloud and typed on phones. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ABANDONED_AFTER_MS = 10 * 60 * 1000;

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly deps: RoomDependencies,
    private readonly teamsForNewRoom: () => Record<Side, TeamSetup>,
  ) {}

  create(opponent: OpponentKind, host?: TeamSetup, options?: ExhibitionOptions): Room {
    const code = this.generateCode();
    const teams = this.teamsForNewRoom();
    if (host) teams.home = host;
    const settings = options ?? (host ? DEFAULT_EXHIBITION : undefined);
    if (settings) {
      teams.home = exhibitionTeam(teams.home, settings.fairPlay);
      const difficulty = settings.difficulty === 'casual' ? 0.88 : settings.difficulty === 'challenging' ? 1.12 : 1;
      const hostAverage = teams.home.squad.reduce((sum, p) => sum + overallRating(p), 0) / teams.home.squad.length;
      teams.away = exhibitionTeam(teams.away, settings.fairPlay || opponent === 'bot', opponent === 'bot' ? difficulty * hostAverage / 60 : 1);
    }
    const deps = settings ? { ...this.deps, rules: exhibitionRules(this.deps.rules, settings) } : this.deps;
    const room = new Room(code, opponent, teams, deps, settings);
    this.rooms.set(code, room);
    return room;
  }

  activeRoom(clientId: string): Room | undefined {
    return [...this.rooms.values()].find(room => room.hasConnectedManager(clientId));
  }

  isClubBusy(ownerId: string): boolean { return !!this.activeRoom(ownerId); }

  find(code: string): Room {
    const room = this.rooms.get(code.trim().toUpperCase());
    if (!room) throw new GameError('room_not_found', `Room ${code.toUpperCase()} does not exist.`);
    return room;
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Disposes rooms nobody has been connected to for a while. */
  sweep(): void {
    const now = this.deps.scheduler.now();
    for (const [code, room] of this.rooms) {
      if (room.isAbandoned(now, ABANDONED_AFTER_MS)) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }

  private generateCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }
}
