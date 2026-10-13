import type { Controller } from './controller';
import type { Actions, Handler } from './dom/events';
import type { Settings } from './settings';
import type { AppState, ToastKind, UiState } from './state';
import type { Store } from './store';

/** What an action handler gets: state access, staging, feedback and the device. */
export interface Ctx {
  store: Store<AppState>;
  device: Controller;
  get(): AppState;
  /** Merge into view-only state. */
  ui(patch: Partial<UiState>): void;
  /** Edit the draft. Nothing is sent to the mouse. Ignored while a write runs. */
  stage(edit: (draft: Settings) => void): void;
  toast(msg: string, kind?: ToastKind): void;
  /** Spin the hero readout over to a new DPI value. */
  scramble(dpi: number): void;
}

export type AppActions = Actions<Ctx>;
export type AppHandler = Handler<Ctx>;
