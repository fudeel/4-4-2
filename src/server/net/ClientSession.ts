import type { ServerMessage } from '../../shared/protocol';

/** Anything that can deliver server messages to one client. Keeps rooms independent of the transport. */
export interface MessageSink {
  send(message: ServerMessage): void;
}

/** One connected browser tab. */
export class ClientSession {
  name = 'Manager';
  roomCode: string | null = null;

  constructor(
    readonly clientId: string,
    private readonly sink: MessageSink,
  ) {}

  send(message: ServerMessage): void {
    this.sink.send(message);
  }
}
