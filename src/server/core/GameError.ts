import type { ErrorCode } from '../../shared/protocol';

/** A rule violation caused by a client request. Its message is safe to show to the player. */
export class GameError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GameError';
  }
}
