import type { Sfx } from '../../audio/Sfx';
import type { ClientState, GameActions, GameStore } from '../../state/GameStore';
import type { Toaster } from '../components/Toaster';

export interface ScreenContext {
  actions: GameActions;
  store: GameStore;
  sfx: Sfx;
  toaster: Toaster;
}

export interface Screen {
  readonly element: HTMLElement;
  update(state: ClientState): void;
  destroy(): void;
}
