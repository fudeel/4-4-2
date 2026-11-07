import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/** Serves the built client (`npm run build`) in production. In development Vite serves it instead. */
export function createStaticHandler(rootDir: string) {
  const root = resolve(rootDir);
  const hasBuild = existsSync(join(root, 'index.html'));

  return (req: IncomingMessage, res: ServerResponse): void => {
    if (!hasBuild) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('4-4-2 game server is running. In development open the Vite URL (http://localhost:5173). For production run `npm run build` first.');
      return;
    }
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const candidate = normalize(join(root, urlPath));
    const safe = candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile();
    const filePath = safe ? candidate : join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream' });
    res.end(readFileSync(filePath));
  };
}
