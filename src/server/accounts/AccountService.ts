import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_PATTERN, type AccountView } from '../../shared/model/account';
import { JsonFileStore } from '../data/JsonFileStore';

const derive = promisify(scrypt);
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = '442_session';
interface Account extends AccountView { key: string; salt: string; passwordHash: string; createdAt: number }
interface Session { digest: string; accountId: string; expiresAt: number }
export interface AccountDatabase { accounts: Account[]; sessions: Session[] }

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Passwords are salted scrypt hashes; only digests of random session tokens reach disk. */
export class AccountService {
  readonly store: JsonFileStore<AccountDatabase>;
  constructor(path: string, private readonly now: () => number = Date.now) {
    this.store = new JsonFileStore(path, () => ({ accounts: [], sessions: [] }));
  }

  async register(username: unknown, password: unknown): Promise<{ account: AccountView; token: string }> {
    if (typeof username !== 'string' || !USERNAME_PATTERN.test(username.normalize('NFC'))) throw new ApiError(400, 'Username must contain 1–16 letters only. No numbers, spaces or symbols.');
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) throw new ApiError(400, `Password must contain ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`);
    const normalized = username.normalize('NFC');
    const key = normalized.toLowerCase();
    if (this.store.read().accounts.some(a => a.key === key)) throw new ApiError(409, 'That username is already taken.');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await derive(password, salt, 64) as Buffer).toString('hex');
    const account: Account = { id: randomBytes(16).toString('hex'), username: normalized, key, salt, passwordHash, createdAt: this.now() };
    this.store.update(db => {
      // Recheck after the asynchronous hash to serialize simultaneous registrations.
      if (db.accounts.some(a => a.key === key)) throw new ApiError(409, 'That username is already taken.');
      db.accounts.push(account);
    });
    return { account: this.publicAccount(account), token: this.issue(account.id) };
  }

  async login(username: unknown, password: unknown): Promise<{ account: AccountView; token: string }> {
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > PASSWORD_MAX) throw new ApiError(401, 'Incorrect username or password.');
    const account = this.store.read().accounts.find(a => a.key === username.normalize('NFC').toLowerCase());
    const actual = await derive(password, account?.salt ?? 'unregistered-account', 64) as Buffer;
    const expected = Buffer.from(account?.passwordHash ?? '00'.repeat(64), 'hex');
    if (!timingSafeEqual(actual, expected) || !account) throw new ApiError(401, 'Incorrect username or password.');
    return { account: this.publicAccount(account), token: this.issue(account.id) };
  }

  authenticateCookie(cookie: string | undefined): AccountView | null {
    const token = this.tokenFromCookie(cookie);
    if (!token) return null;
    const session = this.store.read().sessions.find(s => s.digest === this.digest(token) && s.expiresAt > this.now());
    const account = session && this.store.read().accounts.find(a => a.id === session.accountId);
    return account ? this.publicAccount(account) : null;
  }

  logout(cookie: string | undefined): void {
    const token = this.tokenFromCookie(cookie);
    if (token) this.store.update(db => { db.sessions = db.sessions.filter(s => s.digest !== this.digest(token)); });
  }

  private issue(accountId: string): string {
    const token = randomBytes(32).toString('hex');
    this.store.update(db => {
      db.sessions = db.sessions.filter(s => s.expiresAt > this.now());
      const own = db.sessions.filter(s => s.accountId === accountId);
      if (own.length >= 10) db.sessions = db.sessions.filter(s => s !== own[0]);
      db.sessions.push({ digest: this.digest(token), accountId, expiresAt: this.now() + SESSION_MS });
    });
    return token;
  }
  private publicAccount(a: Account): AccountView { return { id: a.id, username: a.username }; }
  private digest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  private tokenFromCookie(cookie = ''): string | undefined {
    return cookie.split(';').map(s => s.trim()).find(s => s.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  }
}
