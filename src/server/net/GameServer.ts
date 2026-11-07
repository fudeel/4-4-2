import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { WS_PATH, type ClientMessage, type ServerMessage } from '../../shared/protocol';
import { GameError } from '../core/GameError';
import type { Clock } from '../core/Scheduler';
import type { RoomRegistry } from '../rooms/RoomRegistry';
import { ClientSession } from './ClientSession';
import { parseClientMessage } from './MessageParser';
import type { AccountService } from '../accounts/AccountService';

const HEARTBEAT_MS = 15_000;

/** WebSocket gateway: turns socket traffic into room commands and room state into socket messages. */
export class GameServer {
  private readonly sessions = new Map<WebSocket, ClientSession>();
  private readonly alive = new WeakSet<WebSocket>();
  private readonly requests = new WeakMap<WebSocket, IncomingMessage>();

  constructor(
    private readonly registry: RoomRegistry,
    private readonly clock: Clock,
    private readonly accounts?: AccountService,
  ) {}

  attach(httpServer: Server): void {
    const wss = new WebSocketServer({ server: httpServer, path: WS_PATH, maxPayload: 16 * 1024,
      verifyClient: (info: { origin: string; req: IncomingMessage }) => {
        if (!this.accounts) return true;
        try {
          return (!info.origin || new URL(info.origin).host === info.req.headers.host) && !!this.accounts.authenticateCookie(info.req.headers.cookie);
        } catch { return false; }
      },
    });
    wss.on('connection', (socket, req) => { this.requests.set(socket, req); this.onConnection(socket); });
    const heartbeat = setInterval(() => {
      for (const socket of wss.clients) {
        if (!this.alive.has(socket)) {
          socket.terminate();
          continue;
        }
        this.alive.delete(socket);
        socket.ping();
      }
    }, HEARTBEAT_MS);
    heartbeat.unref();
    wss.on('close', () => clearInterval(heartbeat));
  }

  private onConnection(socket: WebSocket): void {
    this.alive.add(socket);
    socket.on('pong', () => this.alive.add(socket));
    socket.on('message', data => this.onMessage(socket, data.toString()));
    socket.on('close', () => this.onClose(socket));
    socket.on('error', () => socket.close());
  }

  private onMessage(socket: WebSocket, raw: string): void {
    const send = (message: ServerMessage) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const message = parseClientMessage(raw);
    if (!message) return send({ type: 'error', code: 'bad_request', message: 'Malformed message.' });
    const account = this.accounts?.authenticateCookie(this.requests.get(socket)?.headers.cookie);
    if (this.accounts && !account) { socket.close(4001, 'Sign in again.'); return; }

    if (message.type === 'hello') {
      const existing = this.sessions.get(socket);
      const clientId = account?.id ?? message.clientId;
      const session = existing?.clientId === clientId ? existing : new ClientSession(clientId, { send });
      session.name = account?.username ?? message.name;
      this.sessions.set(socket, session);
      return send({ type: 'welcome', clientId: session.clientId, serverNow: this.clock.now() });
    }

    const session = this.sessions.get(socket);
    if (!session) return send({ type: 'error', code: 'bad_request', message: 'Say hello first.' });

    try {
      this.route(session, message);
    } catch (error) {
      if (error instanceof GameError) {
        session.send({ type: 'error', code: error.code, message: error.message });
      } else {
        console.error('[server] Unexpected error handling', message.type, error);
        session.send({ type: 'error', code: 'bad_request', message: 'Something went wrong on the server.' });
      }
    }
  }

  private route(session: ClientSession, message: Exclude<ClientMessage, { type: 'hello' }>): void {
    switch (message.type) {
      case 'createRoom': {
        this.leaveCurrentRoom(session);
        const room = this.registry.create(message.opponent);
        room.join(session);
        session.roomCode = room.code;
        return;
      }
      case 'joinRoom': {
        const room = this.registry.find(message.code);
        if (session.roomCode && session.roomCode !== room.code) this.leaveCurrentRoom(session);
        room.join(session);
        session.roomCode = room.code;
        return;
      }
      case 'leaveRoom':
        this.leaveCurrentRoom(session);
        return session.send({ type: 'roomLeft' });
      default:
        if (!session.roomCode) throw new GameError('not_in_room', 'Join a room first.');
        this.registry.find(session.roomCode).handle(session.clientId, message);
    }
  }

  private leaveCurrentRoom(session: ClientSession): void {
    if (!session.roomCode) return;
    try {
      this.registry.find(session.roomCode).leave(session.clientId);
    } catch {
      // Room already gone.
    }
    session.roomCode = null;
  }

  private onClose(socket: WebSocket): void {
    const session = this.sessions.get(socket);
    this.sessions.delete(socket);
    if (!session?.roomCode) return;
    try {
      this.registry.find(session.roomCode).disconnected(session);
    } catch {
      // Room already gone.
    }
  }
}
