import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { DEFAULT_RULES } from '../shared/rules';
import { SeededRng } from './core/Random';
import { SystemScheduler } from './core/Scheduler';
import { createJsonDatabase } from './data/JsonDatabase';
import type { TeamSetup } from './match/Match';
import { GameServer } from './net/GameServer';
import { createStaticHandler } from './net/StaticFiles';
import { RoomRegistry } from './rooms/RoomRegistry';
import { AccountService } from './accounts/AccountService';
import { ManagerApi } from './net/ManagerApi';
import { ClubService } from './clubs/ClubService';

/* Composition root: the only place that knows concrete implementations. */

const PORT = Number(process.env.GAME_PORT ?? process.env.PORT ?? 3001);
const DB_PATH = resolve(process.env.DB_PATH ?? 'data/db.json');

const db = createJsonDatabase(DB_PATH);
const clubs = new ClubService(resolve(process.env.CLUBS_PATH ?? 'data/clubs.json'));
const scheduler = new SystemScheduler();

function teamsForNewRoom(): { home: TeamSetup; away: TeamSetup } {
  const [home, away] = db.teams.findAll();
  if (!home || !away) throw new Error('The database needs at least two teams.');
  return {
    home: { team: home, squad: db.players.findByTeam(home.id) },
    away: { team: away, squad: db.players.findByTeam(away.id) },
  };
}

const registry = new RoomRegistry(
  { db, rules: DEFAULT_RULES, scheduler, createRng: () => new SeededRng(randomInt(2 ** 31)), onFinished: (id, summary) => clubs.recordMatch(id, summary), onLineup: (ownerId, lineup) => clubs.setLineup(ownerId, lineup) },
  teamsForNewRoom,
);

const accounts = new AccountService(resolve(process.env.ACCOUNTS_PATH ?? 'data/managers.json'));
const api = new ManagerApi(accounts, clubs);
const staticHandler = createStaticHandler(resolve('dist/client'));
const httpServer = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) void api.handle(req, res);
  else staticHandler(req, res);
});
new GameServer(registry, scheduler, accounts, clubs).attach(httpServer);
setInterval(() => registry.sweep(), 60_000).unref();

httpServer.listen(PORT, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter(net => net && net.family === 'IPv4' && !net.internal)
    .map(net => net!.address);
  console.log(`⚽ 4-4-2 game server listening on :${PORT}  (db: ${DB_PATH})`);
  if (existsSync(resolve('dist/client/index.html'))) {
    if (lan.length) console.log(`   Play on your LAN: ${lan.map(ip => `http://${ip}:${PORT}`).join('  ')}`);
  } else {
    console.log('   Dev mode: open the Vite URL (port 5173). From a phone, use the "Network" address Vite prints.');
  }
});
