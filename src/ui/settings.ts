import { X3_BUTTONS, describeBinding, type Binding } from '../protocol/buttons';
import { PulsarX3, type DpiStages } from '../protocol/device';
import { ProtocolError } from '../protocol/transport';

/**
 * Everything the page can edit, as one plain object. The UI keeps two of
 * these: `settings` (what the mouse holds, last read back) and `draft`
 * (what the user has staged). Nothing is written until the draft is applied.
 */
export interface Settings {
  polling: number | null;
  debounce: number;
  lod: number;
  motionSync: boolean;
  angleSnap: boolean;
  ripple: boolean;
  sleepTimer: number;
  lowPower: number;
  dpi: DpiStages;
  /** Read-only: what the sensor runs right now. Never diffed or written. */
  currentDpi: { x: number; y: number };
  buttons: Record<number, Binding>;
}

export const SLEEP_CHOICES: [number, string][] = [
  [30, '30 s'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min'], [900, '15 min'],
];

export function cloneSettings(s: Settings): Settings {
  return structuredClone(s);
}

/** Read every editable value from the mouse. */
export async function readSettings(dev: PulsarX3): Promise<Settings> {
  const buttons: Record<number, Binding> = {};
  for (const b of X3_BUTTONS) buttons[b.id] = await dev.getButton(b.id);
  return {
    polling: await dev.getPollingRate(),
    debounce: await dev.getDebounce(),
    lod: await dev.getLod(),
    motionSync: await dev.getMotionSync(),
    angleSnap: await dev.getAngleSnap(),
    ripple: await dev.getRippleControl(),
    sleepTimer: await dev.getSleepTimer(),
    lowPower: await dev.getLowPowerThreshold(),
    dpi: await dev.getDpiStages(),
    currentDpi: await dev.getCurrentDpi(),
    buttons,
  };
}

// ── Formatting ───────────────────────────────────────────────────────────

export const fmt = {
  polling: (hz: number | null) => (hz === null ? 'unknown' : `${hz} Hz`),
  debounce: (ms: number) => `${ms} ms`,
  lod: (mm: number) => `${mm} mm`,
  flag: (on: boolean) => (on ? 'on' : 'off'),
  sleep: (s: number) => SLEEP_CHOICES.find(([sec]) => sec === s)?.[1] ?? `${s} s`,
  lowPower: (p: number) => `${p}%`,
  dpi: (d: DpiStages) =>
    d.stages.map((st, i) => {
      const v = st.x === st.y ? `${st.x}` : `${st.x}×${st.y}`;
      return i + 1 === d.active ? `[${v}]` : v;
    }).join(' / '),
  dpiActive: (d: DpiStages) => `stage ${d.active} (${d.stages[d.active - 1]?.x ?? '?'} DPI)`,
};

// ── Diff ─────────────────────────────────────────────────────────────────

export interface Change {
  /** 'polling' | 'debounce' | … | 'dpi' | 'dpiActive' | 'button:<id>' */
  key: string;
  label: string;
  before: string;
  after: string;
}

function sameStages(a: DpiStages, b: DpiStages): boolean {
  return a.stages.length === b.stages.length && a.stages.every((s, i) => s.x === b.stages[i].x && s.y === b.stages[i].y);
}

function sameBinding(a: Binding | undefined, b: Binding | undefined): boolean {
  if (!a || !b) return a === b;
  return a.type === b.type && a.a1 === b.a1 && a.a2 === b.a2;
}

/** What differs between two settings objects, in display order. */
export function diffSettings(base: Settings, draft: Settings): Change[] {
  const out: Change[] = [];
  const scalar = <K extends keyof Settings>(key: K, label: string, f: (v: Settings[K]) => string) => {
    if (base[key] !== draft[key]) out.push({ key, label, before: f(base[key]), after: f(draft[key]) });
  };

  if (!sameStages(base.dpi, draft.dpi)) {
    out.push({ key: 'dpi', label: 'DPI stages', before: fmt.dpi(base.dpi), after: fmt.dpi(draft.dpi) });
  } else if (base.dpi.active !== draft.dpi.active) {
    out.push({ key: 'dpiActive', label: 'Active DPI stage', before: fmt.dpiActive(base.dpi), after: fmt.dpiActive(draft.dpi) });
  }
  scalar('polling', 'Polling rate', fmt.polling);
  scalar('lod', 'Lift-off distance', fmt.lod);
  scalar('debounce', 'Debounce', fmt.debounce);
  scalar('motionSync', 'Motion sync', fmt.flag);
  scalar('angleSnap', 'Angle snapping', fmt.flag);
  scalar('ripple', 'Ripple control', fmt.flag);
  for (const b of X3_BUTTONS) {
    if (!sameBinding(base.buttons[b.id], draft.buttons[b.id])) {
      out.push({
        key: `button:${b.id}`, label: b.label,
        before: base.buttons[b.id] ? describeBinding(base.buttons[b.id]) : '—',
        after: draft.buttons[b.id] ? describeBinding(draft.buttons[b.id]) : '—',
      });
    }
  }
  scalar('sleepTimer', 'Sleep timer', fmt.sleep);
  scalar('lowPower', 'Low power mode', fmt.lowPower);
  return out;
}

/**
 * Copy the fields named by `changes` from `source` onto a clone of `target`.
 * Used for "revert": take the committed state and put the pre-apply values
 * back for exactly the fields that the apply touched.
 */
export function pickChanges(target: Settings, source: Settings, changes: Change[]): Settings {
  const out = cloneSettings(target);
  for (const c of changes) {
    if (c.key === 'dpi' || c.key === 'dpiActive') out.dpi = structuredClone(source.dpi);
    else if (c.key.startsWith('button:')) {
      const id = Number(c.key.slice(7));
      if (source.buttons[id]) out.buttons[id] = { ...source.buttons[id] };
    } else {
      const k = c.key as Exclude<keyof Settings, 'dpi' | 'buttons' | 'currentDpi'>;
      (out as unknown as Record<string, unknown>)[k] = source[k];
    }
  }
  return out;
}

// ── Write plan ───────────────────────────────────────────────────────────

export interface WriteOp {
  key: string;
  label: string;
  run(dev: PulsarX3): Promise<void>;
}

/**
 * The device writes needed to move the mouse from `base` to `draft`, one
 * per changed field. Polling goes last: on the dongle it renegotiates the
 * radio link, which is the one write most likely to disturb what follows.
 */
export function planWrites(base: Settings, draft: Settings): WriteOp[] {
  const ops: WriteOp[] = [];
  for (const c of diffSettings(base, draft)) {
    switch (c.key) {
      case 'dpi': ops.push({ ...c, run: (d) => d.setDpiStages(draft.dpi.stages, draft.dpi.active) }); break;
      case 'dpiActive': ops.push({ ...c, run: (d) => d.setActiveDpiStage(draft.dpi.active) }); break;
      case 'lod': ops.push({ ...c, run: (d) => d.setLod(draft.lod) }); break;
      case 'debounce': ops.push({ ...c, run: (d) => d.setDebounce(draft.debounce) }); break;
      case 'motionSync': ops.push({ ...c, run: (d) => d.setMotionSync(draft.motionSync) }); break;
      case 'angleSnap': ops.push({ ...c, run: (d) => d.setAngleSnap(draft.angleSnap) }); break;
      case 'ripple': ops.push({ ...c, run: (d) => d.setRippleControl(draft.ripple) }); break;
      case 'sleepTimer': ops.push({ ...c, run: (d) => d.setSleepTimer(draft.sleepTimer) }); break;
      case 'lowPower': ops.push({ ...c, run: (d) => d.setLowPowerThreshold(draft.lowPower) }); break;
      case 'polling': break; // appended below
      default:
        if (c.key.startsWith('button:')) {
          const id = Number(c.key.slice(7));
          ops.push({ ...c, run: (d) => d.setButton(id, draft.buttons[id]) });
        }
    }
  }
  if (base.polling !== draft.polling && draft.polling !== null) {
    const hz = draft.polling;
    ops.push({ key: 'polling', label: 'Polling rate', run: (d) => d.setPollingRate(hz) });
  }
  return ops;
}

export interface WriteFailure {
  key: string;
  label: string;
  error: unknown;
}

/**
 * Run the plan in order. A field that the mouse rejects is recorded and the
 * rest still goes through; an unreachable (asleep) mouse aborts at once so
 * the caller can wait for it and retry the whole draft. `onStep` is told
 * before each write starts, for progress display.
 */
export async function runWrites(
  dev: PulsarX3,
  ops: WriteOp[],
  onStep?: (index: number, op: WriteOp) => void,
): Promise<WriteFailure[]> {
  const failures: WriteFailure[] = [];
  for (const [i, op] of ops.entries()) {
    onStep?.(i, op);
    try {
      await op.run(dev);
    } catch (e) {
      if (e instanceof ProtocolError && (e.code === 'unreachable' || e.code === 'disconnected')) throw e;
      failures.push({ key: op.key, label: op.label, error: e });
    }
  }
  return failures;
}

// ── Profile files ────────────────────────────────────────────────────────

export const PROFILE_FORMAT = 'pulsar-x3-web-profile';

export function exportSettings(s: Settings, device: string): Record<string, unknown> {
  return {
    format: PROFILE_FORMAT,
    version: 1,
    device,
    exported: new Date().toISOString(),
    polling: s.polling,
    debounce: s.debounce,
    lod: s.lod,
    motionSync: s.motionSync,
    angleSnap: s.angleSnap,
    ripple: s.ripple,
    sleepTimer: s.sleepTimer,
    lowPower: s.lowPower,
    dpi: { active: s.dpi.active, stages: s.dpi.stages.map((st) => (st.x === st.y ? st.x : [st.x, st.y])) },
    buttons: Object.fromEntries(X3_BUTTONS.map((b) => [b.key, s.buttons[b.id]])),
  };
}

/**
 * Merge a profile file onto `base`, producing a draft. Unknown or malformed
 * fields are skipped and reported so the user sees what was ignored.
 */
export function importSettings(base: Settings, data: unknown): { draft: Settings; skipped: string[] } {
  const out = cloneSettings(base);
  const skipped: string[] = [];
  if (!data || typeof data !== 'object') throw new Error('Not a profile object');
  const d = data as Record<string, unknown>;
  if (d.format !== PROFILE_FORMAT) throw new Error('Unrecognised profile file');

  const num = (k: 'debounce' | 'lod' | 'sleepTimer' | 'lowPower') => {
    if (d[k] === undefined) return;
    if (typeof d[k] === 'number' && Number.isFinite(d[k])) out[k] = d[k] as number; else skipped.push(k);
  };
  const bool = (k: 'motionSync' | 'angleSnap' | 'ripple') => {
    if (d[k] === undefined) return;
    if (typeof d[k] === 'boolean') out[k] = d[k] as boolean; else skipped.push(k);
  };
  if (d.polling !== undefined) {
    if (typeof d.polling === 'number' || d.polling === null) out.polling = d.polling; else skipped.push('polling');
  }
  num('debounce'); num('lod'); num('sleepTimer'); num('lowPower');
  bool('motionSync'); bool('angleSnap'); bool('ripple');

  const dpi = d.dpi as { active?: unknown; stages?: unknown } | undefined;
  if (dpi !== undefined) {
    const stages = Array.isArray(dpi.stages)
      ? dpi.stages.map((v): { x: number; y: number } | null => {
        if (typeof v === 'number') return { x: v, y: v };
        if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') return { x: v[0], y: v[1] };
        return null;
      })
      : null;
    if (stages && stages.length && stages.every((s) => s !== null)) {
      const active = typeof dpi.active === 'number' && dpi.active >= 1 && dpi.active <= stages.length ? dpi.active : 1;
      out.dpi = { active, stages: stages as { x: number; y: number }[] };
    } else skipped.push('dpi');
  }

  const buttons = d.buttons as Record<string, unknown> | undefined;
  if (buttons && typeof buttons === 'object') {
    for (const b of X3_BUTTONS) {
      const bind = buttons[b.key] as Partial<Binding> | undefined;
      if (bind === undefined) continue;
      if (bind && typeof bind.type === 'number' && typeof bind.a1 === 'number' && typeof bind.a2 === 'number') {
        out.buttons[b.id] = { type: bind.type, a1: bind.a1, a2: bind.a2 };
      } else skipped.push(`buttons.${b.key}`);
    }
  }
  return { draft: out, skipped };
}
