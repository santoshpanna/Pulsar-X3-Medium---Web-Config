import type { TraceEntry } from '../protocol/transport';
import { diffSettings, type Change, type Settings } from './settings';

/**
 * idle        nothing connected: the connect screen
 * connecting  opening the device and reading it: the boot log
 * live        the editor
 * asleep      the dongle is open but the mouse does not answer; retrying
 */
export type Phase = 'idle' | 'connecting' | 'live' | 'asleep';

export type ToastKind = 'ok' | 'err' | 'info';
export type Theme = 'auto' | 'light' | 'dark';

export interface DeviceInfo {
  productName: string;
  productId: number;
  mouseName: string;
  firmware: string;
  battery: number | null;
  charging: boolean;
  wireless: boolean;
  maxHz: number;
}

export interface BootLine {
  label: string;
  value: string;
  status: 'run' | 'ok' | 'err';
}

/** The last apply, kept so it can be undone. */
export interface Applied {
  before: Settings;
  changes: Change[];
  at: number;
}

/** A write in flight, for the progress bar. */
export interface Progress {
  verb: string;
  done: number;
  total: number;
  label: string;
}

export interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
  ms: number;
}

/** View-only state: never sent to the mouse. */
export interface UiState {
  /** Physical button whose binding the picker edits. */
  button: number;
  /** Button whose key combination is being recorded, if any. */
  capturing: number | null;
  capturePreview: string;
  /** Text typed into a DPI field and not yet committed, by stage index. */
  dpiText: Record<number, string>;
  diffOpen: boolean;
  traceOpen: boolean;
  /** Digits shown by the hero while it scrambles to a new value. */
  scramble: string | null;
  hold: { name: string; pct: number } | null;
  theme: Theme;
}

export interface AppState {
  hidSupported: boolean;
  demo: boolean;
  phase: Phase;
  error: string | null;
  boot: BootLine[];
  info: DeviceInfo | null;
  /** What the mouse holds (last read back). */
  settings: Settings | null;
  /** What the user has staged. A full Settings; equal to `settings` when clean. */
  draft: Settings | null;
  applied: Applied | null;
  progress: Progress | null;
  busy: boolean;
  sleepTry: number;
  /** Link-quality samples from the dongle, oldest first. */
  signal: number[];
  trace: TraceEntry[];
  toast: Toast | null;
  ui: UiState;
}

export const SIGNAL_SAMPLES = 16;
export const TRACE_LIMIT = 300;

export function initialState(hidSupported: boolean, theme: Theme): AppState {
  return {
    hidSupported,
    demo: false,
    phase: 'idle',
    error: null,
    boot: [],
    info: null,
    settings: null,
    draft: null,
    applied: null,
    progress: null,
    busy: false,
    sleepTry: 0,
    signal: [],
    trace: [],
    toast: null,
    ui: {
      button: 0x01,
      capturing: null,
      capturePreview: '',
      dpiText: {},
      diffOpen: true,
      traceOpen: false,
      scramble: null,
      hold: null,
      theme,
    },
  };
}

/** What the draft changes relative to the mouse. */
export function pendingChanges(s: AppState): Change[] {
  return s.settings && s.draft ? diffSettings(s.settings, s.draft) : [];
}
