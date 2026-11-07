import { WS_PATH, type ClientMessage, type ServerMessage } from '../../shared/protocol';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

type Listener<T> = (value: T) => void;

/** WebSocket transport with automatic reconnection. Knows nothing about game rules. */
export class GameConnection {
  private socket: WebSocket | null = null;
  private retries = 0;
  private readonly messageListeners = new Set<Listener<ServerMessage>>();
  private readonly statusListeners = new Set<Listener<ConnectionStatus>>();
  private readonly openListeners = new Set<() => void>();

  constructor(private readonly url = GameConnection.defaultUrl()) {}

  static defaultUrl(): string {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}${WS_PATH}`;
  }

  connect(): void {
    this.setStatus('connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.retries = 0;
      this.openListeners.forEach(l => l());
    });
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        this.messageListeners.forEach(l => l(message));
      } catch (error) {
        console.warn('Bad server message', error);
      }
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setStatus('offline');
      const delay = Math.min(5000, 500 * 2 ** this.retries++);
      setTimeout(() => this.connect(), delay);
    });
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  onMessage(listener: Listener<ServerMessage>): void {
    this.messageListeners.add(listener);
  }

  onOpen(listener: () => void): void {
    this.openListeners.add(listener);
  }

  onStatus(listener: Listener<ConnectionStatus>): void {
    this.statusListeners.add(listener);
  }

  setOnline(): void {
    this.setStatus('online');
  }

  private setStatus(status: ConnectionStatus): void {
    this.statusListeners.forEach(l => l(status));
  }
}
