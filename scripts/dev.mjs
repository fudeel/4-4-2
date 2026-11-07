// Runs the game server (tsx watch) and the Vite client side by side with prefixed logs.
// Uses the current Node binary directly, so it works even when node/npm aren't on PATH.
import { spawn } from 'node:child_process';

const processes = [
  { name: 'server', color: '\x1b[34m', args: ['node_modules/tsx/dist/cli.mjs', 'watch', 'src/server/main.ts'] },
  { name: 'client', color: '\x1b[32m', args: ['node_modules/vite/bin/vite.js'] },
];

// The game server gets its own port so a PORT injected by other tooling can't collide with Vite.
const env = { ...process.env, GAME_PORT: process.env.GAME_PORT ?? '3001' };

const children = processes.map(({ name, color, args }) => {
  const child = spawn(process.execPath, args, { stdio: ['inherit', 'pipe', 'pipe'], env });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = stream => target => stream.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) target.write(prefix + line + '\n');
  });
  pipe(child.stdout)(process.stdout);
  pipe(child.stderr)(process.stderr);
  child.on('exit', code => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
