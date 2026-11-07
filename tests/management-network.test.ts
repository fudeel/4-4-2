import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { AccountService } from '../src/server/accounts/AccountService';
import { ClubService } from '../src/server/clubs/ClubService';
import { NightService } from '../src/server/clubs/NightService';
import { SeededRng } from '../src/server/core/Random';
import { ManualScheduler } from '../src/server/core/Scheduler';
import { createJsonDatabase } from '../src/server/data/JsonDatabase';
import { GameServer } from '../src/server/net/GameServer';
import { ManagerApi } from '../src/server/net/ManagerApi';
import { RoomRegistry } from '../src/server/rooms/RoomRegistry';
import { DEFAULT_RULES } from '../src/shared/rules';
import type { ServerMessage } from '../src/shared/protocol';

it('authenticates real HTTP/WebSocket clients, uses owned clubs, and blocks spoofing and in-room spending', async () => {
  const files: string[] = [];
  const file = () => { const p = join(tmpdir(), `442-network-${randomUUID()}.json`); files.push(p); return p; };
  const accounts = new AccountService(file()), clubs = new ClubService(file()), db = createJsonDatabase(file()), scheduler = new ManualScheduler();
  const registry = new RoomRegistry({ db, scheduler, rules: DEFAULT_RULES, createRng: () => new SeededRng(42) }, () => {
    const [home, away] = db.teams.findAll();
    return { home: { team: home!, squad: db.players.findByTeam(home!.id) }, away: { team: away!, squad: db.players.findByTeam(away!.id) } };
  });
  const nights = new NightService(file(), clubs, registry), api = new ManagerApi(accounts, clubs, id => registry.isClubBusy(id), nights);
  const server = createServer((req, res) => { void api.handle(req, res); });
  new GameServer(registry, scheduler, accounts, clubs).attach(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
  const base = `http://127.0.0.1:${address.port}`;
  const sockets: WebSocket[] = [];
  const post = (path: string, data: unknown, cookie = '') => fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(data) });
  const connect = async (cookie: string) => {
    const socket = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie } }); sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    return socket;
  };
  const message = (socket: WebSocket, type: ServerMessage['type']) => new Promise<ServerMessage>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', receive); reject(new Error(`Missing ${type}`)); }, 3000);
    const receive = (raw: Buffer) => { const m = JSON.parse(raw.toString()) as ServerMessage; if (m.type === type) { clearTimeout(timer); socket.off('message', receive); resolve(m); } };
    socket.on('message', receive);
  });
  try {
    const registration = await post('register', { username: 'Alice', password: 'password' });
    const owner = (await registration.json()).account;
    const cookie = registration.headers.get('set-cookie')!.split(';')[0]!;
    const clubRes = await post('club', { name: 'Network FC', shortName: 'NET', color: '#aa3355' }, cookie);
    expect(clubRes.status).toBe(201);
    const club = (await clubRes.json()).club;
    const anonymous = new WebSocket(base.replace('http', 'ws') + '/ws'); sockets.push(anonymous);
    await expect(new Promise<void>((resolve, reject) => { anonymous.once('open', resolve); anonymous.once('error', reject); })).rejects.toThrow();
    const socket = await connect(cookie);
    const welcome = message(socket, 'welcome');
    socket.send(JSON.stringify({ type: 'hello', clientId: 'someone-elses-id', name: 'Impersonator' }));
    const greeting = await welcome;
    expect(greeting.type === 'welcome' && greeting.clientId).toBe(owner.id);
    const nextState = message(socket, 'state');
    socket.send(JSON.stringify({ type: 'createRoom', opponent: 'human' }));
    const state = await nextState;
    if (state.type !== 'state') throw new Error('Missing state');
    expect(state.view.teams.home.team.id).toBe(club.id);
    expect(state.view.teams.home.manager?.name).toBe('Alice');
    const denied = await post('club/upgrade', { facility: 'youth', ownerId: 'somebody-else' }, cookie);
    expect(denied.status).toBe(409);
    expect(clubs.findOwner(owner.id)!.budget).toBe(100000);
    const leave = message(socket, 'roomLeft'); socket.send(JSON.stringify({ type: 'leaveRoom' })); await leave;
    const upgraded = await post('club/upgrade', { facility: 'youth' }, cookie); expect(upgraded.status).toBe(200);
    const logout = await post('logout', {}, cookie); expect(logout.status).toBe(200);
    const closed = new Promise<number>(resolve => socket.once('close', resolve));
    socket.send(JSON.stringify({ type: 'createRoom', opponent: 'bot' }));
    expect(await closed).toBe(4001);
  } finally {
    for (const socket of sockets) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const f of files) if (existsSync(f)) unlinkSync(f);
  }
}, 15000);
