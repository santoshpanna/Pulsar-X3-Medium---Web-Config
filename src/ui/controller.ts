import { DemoTransport } from '../protocol/captured';
import { PulsarX3 } from '../protocol/device';
import { ProtocolError, Session, type TraceEntry } from '../protocol/transport';
import {
  KNOWN_PRODUCTS, MOUSE_NAMES, connect, grantedPulsarDevices, requestPulsarDevices,
  type Connection, type DeviceEvent,
} from '../protocol/webhid';
import {
  cloneSettings, diffSettings, exportSettings, importSettings, pickChanges, planWrites, readSettings, runWrites,
  type Settings, type WriteFailure,
} from './settings';
import { SIGNAL_SAMPLES, TRACE_LIMIT, pendingChanges, type AppState, type BootLine, type ToastKind } from './state';
import type { Store } from './store';

export interface ControllerHooks {
  toast(msg: string, kind: ToastKind): void;
  /** The editor just became usable with these settings (connect or wake). */
  ready(draft: Settings): void;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const hex4 = (n: number) => n.toString(16).padStart(4, '0');

export function errMsg(e: unknown): string {
  if (e instanceof ProtocolError) return e.message;
  if (e instanceof DOMException && e.name === 'NotFoundError') return 'No device selected.';
  if (e instanceof Error) return e.message;
  return String(e);
}

const isAsleep = (e: unknown) => e instanceof ProtocolError && e.code === 'unreachable';

/**
 * Everything that talks to the mouse. Owns the HID connection and writes
 * results into the store; it never touches the DOM.
 */
export class Controller {
  private conn: Connection | null = null;
  private dev: PulsarX3 | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private wakeTimer: number | undefined;
  private demoTimer: number | undefined;
  /** Slows the boot log down in demo mode, where every read is instant. */
  private stepDelay = 0;

  constructor(private store: Store<AppState>, private hooks: ControllerHooks) {}

  private get s(): AppState {
    return this.store.get();
  }

  get connected(): boolean {
    return this.conn !== null;
  }

  start(): void {
    if (new URLSearchParams(location.search).has('demo')) {
      void this.openDemo();
      return;
    }
    if (!this.s.hidSupported) return;
    navigator.hid.addEventListener('disconnect', (ev) => {
      if (this.conn && !this.s.demo && ev.device.productId === this.conn.productId) void this.disconnect('Device unplugged');
    });
    // Release the HID handles before the page goes away. A handle left open
    // across a reload wedges the dongle in this browser session (Windows
    // then fails every feature write with "device not functioning") until
    // the dongle is re-plugged. pagehide fires once the page is really
    // leaving, so a cancelled beforeunload prompt keeps the connection.
    window.addEventListener('pagehide', () => {
      if (this.conn) { void this.conn.close().catch(() => undefined); this.conn = null; }
    });
    void this.autoConnect();
  }

  // ── Connection ─────────────────────────────────────────────────────────

  private async autoConnect() {
    try {
      const devices = await grantedPulsarDevices();
      if (devices.length) await this.openDevices(devices);
    } catch (e) {
      this.store.set({ error: errMsg(e) });
    }
  }

  /** Show the browser's device chooser. Must run inside a user gesture. */
  async pick(): Promise<void> {
    this.store.set({ error: null });
    try {
      const chosen = await requestPulsarDevices();
      if (!chosen.length) return;
      // requestDevice() only returns the collections of the picked product;
      // merge with anything already granted for the same product (the
      // interface-1 event collections may have been granted earlier).
      const granted = await grantedPulsarDevices();
      const pid = chosen[0].productId;
      await this.openDevices([...chosen, ...granted.filter((d) => d.productId === pid && !chosen.includes(d))]);
    } catch (e) {
      this.store.set({ error: errMsg(e) });
    }
  }

  private async openDevices(devices: HIDDevice[]) {
    if (this.conn) await this.disconnect();
    this.stepDelay = 0;
    this.store.set({ phase: 'connecting', boot: [], error: null });
    this.bootLine({ label: 'navigator.hid', value: 'OK', status: 'ok' });
    try {
      const conn = await this.step('Open vendor collection', () => connect(devices), (c) => `3710:${hex4(c.productId)}`);
      conn.session.trace = (t) => this.pushTrace(t);
      this.conn = conn;
      this.dev = new PulsarX3(conn.session);
      this.unsubscribeEvents = conn.onEvent((ev) => this.onDeviceEvent(ev));
      await this.loadAll(true);
      await this.becomeReady();
    } catch (e) {
      if (this.conn && isAsleep(e)) {
        this.startWakeWatch();
      } else {
        if (this.conn) await this.conn.close().catch(() => undefined);
        this.conn = null;
        this.dev = null;
        this.store.set({ phase: 'idle', error: errMsg(e) });
      }
    }
  }

  /** `?demo` or the demo button: frames captured on a real X3, no hardware needed. */
  async openDemo(): Promise<void> {
    if (this.conn) await this.disconnect();
    this.stepDelay = 140;
    const session = new Session(new DemoTransport(), { pollMs: 1 });
    const listeners = new Set<(e: DeviceEvent) => void>();
    this.conn = {
      control: null as unknown as HIDDevice,
      eventDevices: [],
      session,
      productId: 0x5402,
      productName: 'Demo: captured 1K dongle',
      close: async () => { clearInterval(this.demoTimer); },
      onEvent: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    };
    session.trace = (t) => this.pushTrace(t);
    this.dev = new PulsarX3(session);
    this.unsubscribeEvents = this.conn.onEvent((ev) => this.onDeviceEvent(ev));
    this.store.set({ demo: true, phase: 'connecting', boot: [], error: null });
    this.bootLine({ label: 'Demo transport', value: 'CAPTURED FRAMES', status: 'ok' });
    try {
      await this.loadAll(true);
      await this.becomeReady();
    } catch (e) {
      this.store.set({ phase: 'idle', error: errMsg(e) });
      return;
    }
    this.demoTimer = window.setInterval(() => {
      for (const cb of listeners) cb({ kind: 'signal', percent: 90 + Math.floor(Math.random() * 11) });
    }, 1000);
  }

  private async becomeReady() {
    this.bootLine({ label: 'Ready', value: '▶', status: 'ok' });
    await delay(this.stepDelay ? 600 : 350);
    this.store.set({ phase: 'live', sleepTry: 0 });
    this.hooks.ready(this.s.draft!);
  }

  /** The dongle answers 0x02 forever or 0x05 while the mouse sleeps. Poll until it wakes. */
  private startWakeWatch() {
    clearInterval(this.wakeTimer);
    this.store.set({ phase: 'asleep', error: null, sleepTry: 0 });
    this.wakeTimer = window.setInterval(async () => {
      if (!this.dev || this.s.busy) return;
      this.store.set((s) => ({ sleepTry: s.sleepTry + 1 }));
      try {
        await this.loadAll();
        clearInterval(this.wakeTimer);
        this.store.set({ phase: 'live' });
        this.hooks.ready(this.s.draft!);
        this.hooks.toast('Mouse is awake', 'ok');
      } catch (e) {
        if (!isAsleep(e)) {
          clearInterval(this.wakeTimer);
          this.store.set({ phase: this.s.settings ? 'live' : 'idle', error: errMsg(e) });
        }
      }
    }, 2000);
  }

  async disconnect(reason?: string): Promise<void> {
    clearInterval(this.wakeTimer);
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    if (this.conn) await this.conn.close().catch(() => undefined);
    this.conn = null;
    this.dev = null;
    this.store.set((s) => ({
      phase: 'idle', demo: false, boot: [], info: null, settings: null, draft: null, applied: null,
      progress: null, busy: false, signal: [], error: reason ?? null,
      ui: { ...s.ui, capturing: null, dpiText: {} },
    }));
  }

  private onDeviceEvent(ev: DeviceEvent) {
    if (ev.kind === 'signal') {
      this.store.set((s) => ({ signal: [...s.signal, ev.percent].slice(-SIGNAL_SAMPLES) }));
    } else if (ev.kind === 'dpi') {
      const { settings, draft } = this.s;
      if (!settings || !draft) return;
      // The DPI button on the mouse changed the active stage. Follow it in
      // the draft too unless the user has their own DPI edit staged.
      const dpiStaged = pendingChanges(this.s).some((c) => c.key === 'dpi' || c.key === 'dpiActive');
      const nextSettings = { ...cloneSettings(settings), currentDpi: { x: ev.dpi, y: ev.dpi } };
      nextSettings.dpi.active = ev.stage;
      const nextDraft = cloneSettings(draft);
      if (!dpiStaged) nextDraft.dpi.active = ev.stage;
      this.store.set({ settings: nextSettings, draft: nextDraft });
      if (!dpiStaged) this.hooks.ready(nextDraft);
    }
  }

  // ── Reading ────────────────────────────────────────────────────────────

  private bootLine(line: BootLine, index = this.s.boot.length) {
    this.store.set((s) => {
      const boot = s.boot.slice();
      boot[index] = line;
      return { boot };
    });
  }

  /** Run one connection step, logging it on the boot screen. */
  private async step<T>(label: string, fn: () => Promise<T>, show: (r: T) => string = () => 'OK'): Promise<T> {
    const i = this.s.boot.length;
    this.bootLine({ label, value: '', status: 'run' }, i);
    try {
      const r = await fn();
      if (this.stepDelay) await delay(this.stepDelay);
      this.bootLine({ label, value: show(r), status: 'ok' }, i);
      return r;
    } catch (e) {
      this.bootLine({ label, value: isAsleep(e) ? 'ASLEEP' : 'FAILED', status: 'err' }, i);
      throw e;
    }
  }

  /** Re-read everything. Staged edits survive: they are re-based onto the fresh values. */
  private async loadAll(log = false) {
    const dev = this.dev!;
    const conn = this.conn!;
    const run = <T>(label: string, fn: () => Promise<T>, show?: (r: T) => string) => (log ? this.step(label, fn, show) : fn());
    const product = KNOWN_PRODUCTS[conn.productId];

    let mouseName = MOUSE_NAMES[conn.productId] ?? conn.productName;
    if (product?.wireless) {
      const paired = await run('Paired mouse', () => dev.getPairedMouse().catch(() => null), (p) => (p ? MOUSE_NAMES[p.pid] ?? `0x${hex4(p.pid)}` : '—'));
      if (paired) mouseName = MOUSE_NAMES[paired.pid] ?? `Pulsar mouse 0x${hex4(paired.pid)}`;
    }
    const firmware = await run('Firmware', () => dev.getFirmware().catch(() => '?'), (f) => f);
    const power = await run('Power', () => dev.getPower(), (p) => (p.batteryPercent === null ? 'UNKNOWN' : `${p.batteryPercent}%${p.charging ? ' · CHARGING' : ''}`));
    this.store.set({
      info: {
        productName: conn.productName,
        productId: conn.productId,
        mouseName,
        firmware,
        battery: power.batteryPercent,
        charging: power.charging,
        wireless: product?.wireless ?? false,
        maxHz: product?.maxHz ?? 1000,
      },
    });
    const fresh = await run('Read settings', () => readSettings(dev), (f) => `${plural(f.dpi.stages.length, 'stage')} · ${f.polling ?? '?'} Hz`);
    const pending = pendingChanges(this.s);
    const draft = pending.length && this.s.draft ? pickChanges(fresh, this.s.draft, pending) : cloneSettings(fresh);
    this.store.set({ settings: fresh, draft, error: null });
  }

  // ── Writing ────────────────────────────────────────────────────────────

  apply(): void {
    if (this.s.draft) void this.commit(this.s.draft, 'apply');
  }

  revert(): void {
    const { applied, settings } = this.s;
    if (!applied || !settings) return;
    void this.commit(pickChanges(settings, applied.before, applied.changes), 'revert');
  }

  discard(): void {
    const { settings } = this.s;
    if (!settings) return;
    const n = pendingChanges(this.s).length;
    this.store.set((s) => ({ draft: cloneSettings(settings), ui: { ...s.ui, capturing: null, dpiText: {} } }));
    if (n) this.hooks.toast(`Discarded ${plural(n, 'change')}`, 'info');
  }

  /**
   * Write the target to the mouse, then read everything back so the page
   * shows what the mouse really kept. For `apply`, the pre-apply state is
   * remembered so the same changes can be reverted with one click.
   */
  private async commit(target: Settings, mode: 'apply' | 'revert') {
    const dev = this.dev;
    const base = this.s.settings;
    if (!dev || !base || this.s.busy) return;
    const ops = planWrites(base, target);
    if (!ops.length) { this.hooks.toast('Nothing to apply', 'info'); return; }

    const verb = mode === 'apply' ? 'Writing' : 'Reverting';
    const total = ops.length + 1;
    const started = performance.now();
    this.store.set((s) => ({ busy: true, progress: { verb, done: 0, total, label: ops[0].label }, ui: { ...s.ui, capturing: null } }));
    let failures: WriteFailure[] = [];
    let fresh: Settings;
    try {
      failures = await runWrites(dev, ops, (i, op) => this.store.set({ progress: { verb, done: i, total, label: op.label } }));
      this.store.set({ progress: { verb, done: ops.length, total, label: 'Reading back' } });
      fresh = await readSettings(dev);
      // Let the progress bar finish its sweep; real writes take ~30 ms each.
      await delay(Math.max(0, 500 - (performance.now() - started)));
    } catch (e) {
      // Keep the draft so the user can apply again once the mouse is back.
      this.store.set({ busy: false, progress: null, draft: target });
      if (isAsleep(e)) {
        this.hooks.toast('The mouse fell asleep. Your changes are kept; move it and apply again.', 'err');
        this.startWakeWatch();
      } else {
        this.hooks.toast(errMsg(e), 'err');
      }
      return;
    }

    const before = cloneSettings(base);
    const notKept = diffSettings(target, fresh).filter((c) => !failures.some((f) => f.key === c.key));
    this.store.set({
      settings: fresh,
      draft: cloneSettings(fresh),
      applied: mode === 'apply' ? { before, changes: diffSettings(before, fresh), at: Date.now() } : null,
      busy: false,
      progress: null,
    });

    const done = ops.length - failures.length - notKept.length;
    const word = mode === 'apply' ? 'Applied' : 'Reverted';
    if (failures.length || notKept.length) {
      const parts = [
        ...failures.map((f) => `${f.label}: ${errMsg(f.error)}`),
        ...notKept.map((c) => `${c.label}: mouse kept ${c.after}`),
      ];
      this.hooks.toast(`${word} ${done} of ${ops.length}. ${parts.join('; ')}`, 'err');
    } else {
      this.hooks.toast(`${word} ${plural(done, 'change')} · read back OK`, 'ok');
    }
  }

  /** Run something that talks to the mouse outside the draft (refresh, reset). */
  private async withBusy(label: string, fn: () => Promise<void>) {
    if (!this.dev || this.s.busy) return;
    this.store.set({ busy: true });
    try {
      await fn();
      this.store.set({ busy: false });
      this.hooks.toast(label, 'ok');
    } catch (e) {
      this.store.set({ busy: false });
      this.hooks.toast(errMsg(e), 'err');
      if (isAsleep(e)) this.startWakeWatch();
    }
  }

  /** Re-read every setting. Staged edits are kept and re-based onto what the mouse reports. */
  refresh(): void {
    const n = pendingChanges(this.s).length;
    void this.withBusy(n ? `Re-read from the mouse · ${plural(n, 'staged edit')} kept` : 'Re-read from the mouse', () => this.loadAll());
  }

  factoryReset(): void {
    const dev = this.dev;
    if (!dev) return;
    void this.withBusy('Factory reset sent · settings re-read', async () => {
      await dev.factoryReset();
      this.store.set({ draft: null, applied: null });
      await this.loadAll();
    });
  }

  // ── Profile files ──────────────────────────────────────────────────────

  exportJson(): void {
    const { draft, info } = this.s;
    if (!draft || !info) return;
    const data = exportSettings(draft, info.mouseName);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pulsar-x3-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    const n = pendingChanges(this.s).length;
    this.hooks.toast(n ? `Exported, including ${plural(n, 'unapplied change')}` : 'Exported', 'info');
  }

  async importJson(file: File): Promise<void> {
    const { settings } = this.s;
    if (!settings) return;
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      this.hooks.toast('Not a JSON file', 'err');
      return;
    }
    try {
      const { draft, skipped } = importSettings(settings, data);
      this.store.set((s) => ({ draft, ui: { ...s.ui, capturing: null, dpiText: {} } }));
      const n = pendingChanges(this.s).length;
      const skippedNote = skipped.length ? ` Ignored: ${skipped.join(', ')}.` : '';
      this.hooks.toast(
        n ? `Loaded ${plural(n, 'change')} from ${file.name}. Review them, then apply.${skippedNote}` : `${file.name} matches the mouse already.${skippedNote}`,
        skipped.length ? 'err' : 'info',
      );
      if (n) this.hooks.ready(draft);
    } catch (e) {
      this.hooks.toast(errMsg(e), 'err');
    }
  }

  // ── Diagnostics ────────────────────────────────────────────────────────

  private pushTrace(t: TraceEntry) {
    this.store.set((s) => ({ trace: [...s.trace.slice(-(TRACE_LIMIT - 1)), t] }));
  }
}
