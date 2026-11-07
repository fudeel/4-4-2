import type { ClientMessage } from '../../shared/protocol';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isShortString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 20);
  return cleaned || 'Manager';
}

/** Validates untrusted input from the socket. Returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > 8_000) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || typeof data.type !== 'string') return null;

  switch (data.type) {
    case 'hello':
      return isShortString(data.clientId, 64) && typeof data.name === 'string'
        ? { type: 'hello', clientId: data.clientId, name: sanitizeName(data.name) }
        : null;
    case 'createRoom':
      return data.opponent === 'human' || data.opponent === 'bot' ? { type: 'createRoom', opponent: data.opponent } : null;
    case 'joinRoom':
      return isShortString(data.code, 12) ? { type: 'joinRoom', code: data.code } : null;
    case 'leaveRoom':
      return { type: 'leaveRoom' };
    case 'setLineup': {
      const lineup = data.lineup;
      if (!isObject(lineup) || typeof lineup.formationId !== 'string' || !Array.isArray(lineup.slots)) return null;
      if (lineup.slots.length > 11 || !lineup.slots.every(s => s === null || isShortString(s, 32))) return null;
      return { type: 'setLineup', lineup: { formationId: lineup.formationId as never, slots: lineup.slots as (string | null)[] } };
    }
    case 'setReady':
      return typeof data.ready === 'boolean' ? { type: 'setReady', ready: data.ready } : null;
    case 'playCard':
      return data.cardInstanceId === null || isShortString(data.cardInstanceId, 64)
        ? { type: 'playCard', cardInstanceId: data.cardInstanceId as string | null }
        : null;
    case 'requestRematch':
      return { type: 'requestRematch' };
    default:
      return null;
  }
}
