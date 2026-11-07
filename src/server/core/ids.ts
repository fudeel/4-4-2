import { randomBytes } from 'node:crypto';

let counter = 0;

export function uniqueId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${randomBytes(3).toString('hex')}`;
}
