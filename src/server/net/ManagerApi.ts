import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccountService, ApiError, SESSION_COOKIE } from '../accounts/AccountService';
import type { ClubService } from '../clubs/ClubService';
import { FACILITIES, TRAINABLE, type Facility } from '../../shared/model/progression';
import type { AttributeKey } from '../../shared/model/player';

export class ManagerApi {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(readonly accounts: AccountService, readonly clubs?: ClubService, private readonly isBusy: (ownerId: string) => boolean = () => false) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/session') return this.json(res, 200, { account: this.accounts.authenticateCookie(req.headers.cookie) });
      if (req.method === 'GET' && path === '/api/club' && this.clubs) {
        const account = this.accounts.authenticateCookie(req.headers.cookie);
        if (!account) throw new ApiError(401, 'Please sign in.');
        return this.json(res, 200, { club: this.clubs.findOwner(account.id) });
      }
      if (req.method !== 'POST') throw new ApiError(405, 'Method not allowed.');
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new ApiError(403, 'Open this page on the game server to continue.');
      if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'Send JSON data.');
      if (this.clubs && ['/api/club/upgrade', '/api/club/train', '/api/club/promote'].includes(path)) {
        const account = this.accounts.authenticateCookie(req.headers.cookie);
        if (!account) throw new ApiError(401, 'Please sign in.');
        if (this.isBusy(account.id)) throw new ApiError(409, 'Leave your exhibition before changing your club.');
        const data = await this.body(req);
        if (path.endsWith('/upgrade')) {
          if (!FACILITIES.includes(data.facility as Facility)) throw new ApiError(400, 'Choose a facility.');
          return this.json(res, 200, { club: this.clubs.upgrade(account.id, data.facility as Facility) });
        }
        if (typeof data.playerId !== 'string') throw new ApiError(400, 'Choose a player.');
        if (path.endsWith('/train')) {
          if (!TRAINABLE.includes(data.attribute as AttributeKey)) throw new ApiError(400, 'Choose a valid skill.');
          return this.json(res, 200, { club: this.clubs.train(account.id, data.playerId, data.attribute as AttributeKey) });
        }
        return this.json(res, 200, { club: this.clubs.promote(account.id, data.playerId) });
      }
      if (path === '/api/club' && this.clubs) {
        const account = this.accounts.authenticateCookie(req.headers.cookie);
        if (!account) throw new ApiError(401, 'Please sign in.');
        const data = await this.body(req);
        return this.json(res, 201, { club: this.clubs.create(account.id, data.name, data.shortName, data.color) });
      }
      if (path === '/api/logout') {
        this.accounts.logout(req.headers.cookie);
        res.setHeader('Set-Cookie', this.cookie('', req, 0));
        return this.json(res, 200, { ok: true });
      }
      if (path !== '/api/register' && path !== '/api/login') throw new ApiError(404, 'API route not found.');
      this.rateLimit(req.socket.remoteAddress ?? 'local');
      const data = await this.body(req);
      const result = path === '/api/register' ? await this.accounts.register(data.username, data.password) : await this.accounts.login(data.username, data.password);
      res.setHeader('Set-Cookie', this.cookie(result.token, req));
      this.json(res, path === '/api/register' ? 201 : 200, { account: result.account });
    } catch (error) {
      this.json(res, error instanceof ApiError ? error.status : 500, { error: error instanceof ApiError ? error.message : 'The server could not complete this request.' });
    }
  }

  private cookie(token: string, req: IncomingMessage, age = 604800): string {
    const secure = 'encrypted' in req.socket || process.env.COOKIE_SECURE === 'true';
    return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
  }
  private json(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status); res.end(JSON.stringify(value)); }
  private rateLimit(key: string): void {
    const now = Date.now();
    for (const [ip, entry] of this.attempts) if (entry.until <= now) this.attempts.delete(ip);
    const entry = this.attempts.get(key) ?? { count: 0, until: now + 60_000 };
    this.attempts.set(key, entry);
    if (++entry.count > 12) throw new ApiError(429, 'Too many attempts. Please wait a minute.');
  }
  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    let raw = '';
    for await (const chunk of req) {
      raw += String(chunk);
      if (Buffer.byteLength(raw) > 8192) throw new ApiError(413, 'Request too large.');
    }
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new ApiError(400, 'Invalid JSON.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(400, 'Invalid request.');
    return data as Record<string, unknown>;
  }
}
