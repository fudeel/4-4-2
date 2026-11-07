const CLIENT_ID_KEY = '442.clientId';
const NAME_KEY = '442.name';
const ROOM_KEY = '442.room';

function safeGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Storage unavailable (private mode) — the session just won't survive a reload.
  }
}

/** crypto.randomUUID needs a secure context, which phones on plain-http LAN don't have. */
function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Who this browser tab is. The client id lives in sessionStorage, so every tab is a
 * different manager (handy for testing with two tabs) but a reload keeps your seat.
 */
export class Identity {
  readonly clientId: string;
  private currentName: string;
  private currentRoom: string | null;

  constructor() {
    const session = () => sessionStorage;
    this.clientId = safeGet(session, CLIENT_ID_KEY) ?? randomId();
    safeSet(session, CLIENT_ID_KEY, this.clientId);
    this.currentName = safeGet(() => localStorage, NAME_KEY) ?? `Coach ${Math.floor(100 + Math.random() * 900)}`;
    const fromUrl = new URLSearchParams(location.search).get('room');
    this.currentRoom = fromUrl?.toUpperCase() ?? safeGet(session, ROOM_KEY);
  }

  get name(): string {
    return this.currentName;
  }

  set name(value: string) {
    this.currentName = value.trim().slice(0, 20) || this.currentName;
    safeSet(() => localStorage, NAME_KEY, this.currentName);
  }

  get roomCode(): string | null {
    return this.currentRoom;
  }

  set roomCode(code: string | null) {
    this.currentRoom = code;
    safeSet(() => sessionStorage, ROOM_KEY, code);
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    history.replaceState(null, '', url);
  }

  shareLink(code: string): string {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('room', code);
    return url.toString();
  }
}
