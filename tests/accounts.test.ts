import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountService, SESSION_COOKIE } from '../src/server/accounts/AccountService';
import { ManagerApi } from '../src/server/net/ManagerApi';

const files: string[] = [];
function service(now?: () => number) {
  const path = join(tmpdir(), `442-accounts-${randomUUID()}.json`);
  files.push(path);
  return { accounts: new AccountService(path, now), path };
}
const cookie = (token: string) => `${SESSION_COOKIE}=${token}`;
afterEach(() => { for (const file of files.splice(0)) if (existsSync(file)) unlinkSync(file); });

describe('accounts', () => {
  it('persists accounts and hashed credentials, and never stores raw session tokens', async () => {
    const { accounts, path } = service();
    const result = await accounts.register('Manager', 'passwordwithspaces ');
    expect(Object.keys(result.account).sort()).toEqual(['id', 'username']);
    const disk = readFileSync(path, 'utf8');
    expect(disk).not.toContain('passwordwithspaces');
    expect(disk).not.toContain(result.token);
    expect(new AccountService(path).authenticateCookie(cookie(result.token))).toEqual(result.account);
    expect((await accounts.login('mAnAgEr', 'passwordwithspaces ')).account).toEqual(result.account);
  });
  it('accepts letters only, with a strict sixteen-character limit', async () => {
    const { accounts } = service();
    for (const name of ['', 'Manager1', 'Coach Name', 'Coach_', '<script>', 'A'.repeat(17)]) await expect(accounts.register(name, 'password')).rejects.toThrow('1–16 letters');
    await expect(accounts.register('A'.repeat(16), 'password')).resolves.toBeTruthy();
    await expect(accounts.register('José', 'password')).resolves.toBeTruthy();
    await expect(accounts.register('Short', '123')).rejects.toThrow('8–128');
  });
  it('serializes case-insensitive username claims made concurrently', async () => {
    const { accounts } = service();
    const result = await Promise.allSettled([accounts.register('Alice', 'password'), accounts.register('alice', 'password')]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(accounts.store.read().accounts).toHaveLength(1);
  });
  it('rejects wrong credentials, expired cookies and revoked sessions', async () => {
    let now = 1000;
    const { accounts } = service(() => now);
    const first = await accounts.register('Bob', 'password');
    await expect(accounts.login('Bob', 'incorrect')).rejects.toThrow('Incorrect username or password');
    await expect(accounts.login('Nobody', 'incorrect')).rejects.toThrow('Incorrect username or password');
    accounts.logout(cookie(first.token));
    expect(accounts.authenticateCookie(cookie(first.token))).toBeNull();
    const next = await accounts.login('Bob', 'password');
    now += 8 * 24 * 60 * 60 * 1000;
    expect(accounts.authenticateCookie(cookie(next.token))).toBeNull();
  });
  it('serves HttpOnly sessions and rejects cross-origin writes', async () => {
    const { accounts } = service();
    const api = new ManagerApi(accounts);
    const server = createServer((req, res) => { void api.handle(req, res); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const res = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Coach', password: 'password' }) });
      expect(res.status).toBe(201);
      expect(res.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
      const sessionCookie = res.headers.get('set-cookie')!.split(';')[0]!;
      const me = await fetch(`${base}/api/session`, { headers: { cookie: sessionCookie } });
      expect((await me.json()).account.username).toBe('Coach');
      const forbidden = await fetch(`${base}/api/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: '{}' });
      expect(forbidden.status).toBe(403);
      await fetch(`${base}/api/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: sessionCookie }, body: '{}' });
      const signedOut = await fetch(`${base}/api/session`, { headers: { cookie: sessionCookie } });
      expect((await signedOut.json()).account).toBeNull();
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
