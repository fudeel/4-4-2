import { describe, expect, it } from 'vitest';
import type { MatchView } from '../src/shared/model/match';
import type { ServerMessage } from '../src/shared/protocol';
import { DEFAULT_RULES } from '../src/shared/rules';
import { SeededRng } from '../src/server/core/Random';
import { ManualScheduler } from '../src/server/core/Scheduler';
import type { GameDatabase } from '../src/server/data/repositories';
import type { MatchRecord } from '../src/server/data/schema';
import { SEED_PLAYERS, SEED_TEAMS } from '../src/server/data/seed';
import { ClientSession } from '../src/server/net/ClientSession';
import { Room } from '../src/server/rooms/Room';

function createRoom(opponent: 'human' | 'bot') {
  const saved: MatchRecord[] = [];
  const db: GameDatabase = {
    teams: { findAll: () => SEED_TEAMS, findById: id => SEED_TEAMS.find(t => t.id === id) },
    players: { findByTeam: id => SEED_PLAYERS.filter(p => p.teamId === id), findById: id => SEED_PLAYERS.find(p => p.id === id), careerStats: () => undefined },
    matches: { save: record => { saved.push(record); }, recent: () => saved },
  };
  const scheduler = new ManualScheduler();
  let seed = 1;
  const [home, away] = SEED_TEAMS;
  const room = new Room('TEST', opponent, {
    home: { team: home!, squad: SEED_PLAYERS.filter(p => p.teamId === home!.id) },
    away: { team: away!, squad: SEED_PLAYERS.filter(p => p.teamId === away!.id) },
  }, { db, rules: DEFAULT_RULES, scheduler, createRng: () => new SeededRng(seed++) });
  return { room, scheduler, saved };
}

function connect(clientId: string, name: string) {
  const inbox: ServerMessage[] = [];
  const session = new ClientSession(clientId, { send: m => inbox.push(m) });
  session.name = name;
  const latest = (): MatchView => {
    const state = [...inbox].reverse().find((m): m is Extract<ServerMessage, { type: 'state' }> => m.type === 'state');
    if (!state) throw new Error('No state received');
    return state.view;
  };
  return { session, inbox, latest };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('room', () => {
  it('plays a full practice match against the bot, saves it, and starts a rematch', async () => {
    const { room, scheduler, saved } = createRoom('bot');
    const me = connect('me', 'Tester');
    expect(room.join(me.session)).toBe('home');
    room.handle('me', { type: 'setReady', ready: true });
    scheduler.advance(2000); // the bot readies up
    await flush();
    expect(me.latest().phase).toBe('planning');

    for (let guard = 0; guard < 500 && me.latest().phase !== 'fulltime'; guard++) {
      const view = me.latest();
      if (view.phase === 'planning' && !view.selection.locked) room.handle('me', { type: 'playCard', cardInstanceId: null });
      if (view.phase === 'halftime' && !view.teams.home.ready) room.handle('me', { type: 'setReady', ready: true });
      scheduler.advance(1000);
      await flush();
    }

    expect(me.latest().phase).toBe('fulltime');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.home.manager).toBe('Tester');

    room.handle('me', { type: 'requestRematch' });
    await flush();
    expect(me.latest().phase).toBe('lobby');
    expect(me.latest().teams.away.manager?.isBot).toBe(true);
    room.dispose();
  });

  it('keeps the seat when a client reconnects and tells same-named managers apart', async () => {
    const { room } = createRoom('human');
    const a = connect('a', 'Coach');
    const b = connect('b', 'Coach');
    room.join(a.session);
    room.join(b.session);
    await flush();
    expect(b.latest().teams.away.manager?.name).toBe('Coach (2)');

    room.handle('a', { type: 'setReady', ready: true });
    room.handle('b', { type: 'setReady', ready: true });
    room.disconnected(a.session);
    await flush();
    expect(b.latest().teams.home.manager?.connected).toBe(false);

    const again = connect('a', 'Coach');
    expect(room.join(again.session)).toBe('home');
    await flush();
    expect(again.latest().you).toBe('home');
    expect(again.latest().teams.home.manager?.connected).toBe(true);
    room.dispose();
  });
});
