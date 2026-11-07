import type { Lineup } from './model/lineup';
import type { MatchView } from './model/match';

export type OpponentKind = 'human' | 'bot';

export type ClientMessage =
  | { type: 'hello'; clientId: string; name: string }
  | { type: 'createRoom'; opponent: OpponentKind }
  | { type: 'joinRoom'; code: string }
  | { type: 'leaveRoom' }
  | { type: 'setLineup'; lineup: Lineup }
  | { type: 'setReady'; ready: boolean }
  /** `null` = skip this turn. */
  | { type: 'playCard'; cardInstanceId: string | null }
  /** Defence ↔ Attack slider, −100 … +100. */
  | { type: 'setMentality'; value: number }
  | { type: 'requestRematch' };

export type ServerMessage =
  | { type: 'welcome'; clientId: string; serverNow: number }
  | { type: 'state'; view: MatchView }
  | { type: 'roomLeft' }
  | { type: 'error'; code: ErrorCode; message: string };

export type ErrorCode =
  | 'bad_request'
  | 'not_in_room'
  | 'room_not_found'
  | 'room_full'
  | 'invalid_phase'
  | 'invalid_lineup'
  | 'invalid_card'
  | 'already_locked';

export const WS_PATH = '/ws';

export const ROOM_CODE_LENGTH = 4;
