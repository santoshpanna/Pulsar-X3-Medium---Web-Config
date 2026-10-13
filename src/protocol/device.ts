import { type Binding } from './buttons';
import { u16le, u16leBytes } from './packet';
import { ProtocolError, Session } from './transport';

/**
 * Register map of the Pulsar Fusion2 / Sonix protocol as spoken by the
 * Pulsar X3 (directly on its cable, or relayed through the 1K / 8K dongle).
 *
 * Every register below was exercised live against an X3 on a 1K dongle
 * (3710:5402) on 2026-10-13 unless marked otherwise. Register addresses are
 * written (cat, reg, sub); reads set bit 7 of reg.
 */

export const POLL_HZ_TO_VAL: Record<number, number> = {
  125: 0x01, 250: 0x02, 500: 0x04, 1000: 0x08, 2000: 0x10, 4000: 0x20, 8000: 0x40,
};
export const POLL_VAL_TO_HZ: Record<number, number> = Object.fromEntries(
  Object.entries(POLL_HZ_TO_VAL).map(([hz, v]) => [v, Number(hz)]),
);

/**
 * Profile byte. 0 means "the active profile" for the global registers
 * (polling, debounce, sensor flags, power). The per-profile registers (DPI
 * stages, buttons, stage colours) are addressed as profile 1, the profile
 * the X3 runs and the value every read and write was verified with. Reads
 * of those registers with profile 0 were only tried while the mouse was
 * asleep (dongle status 0x05), so they are unverified. The active-profile
 * register (0x02, 0x06, 0x01) did not answer on this mouse.
 */
export const GLOBAL = 0x00;
export const PROFILE = 0x01;

export interface DpiStages {
  active: number; // 1-based
  stages: { x: number; y: number }[];
}

export interface PowerStatus {
  batteryPercent: number | null;
  charging: boolean;
}

export interface PairedMouse {
  vid: number;
  pid: number;
}

export const DPI_MIN = 50;
export const DPI_MAX = 32000;
export const DPI_STEP = 10;
export const MAX_DPI_STAGES = 6;
export const DEBOUNCE_MIN = 0;
export const DEBOUNCE_MAX = 20;
export const SLEEP_MIN_S = 30;
export const SLEEP_MAX_S = 900;
export const LOD_VALUES_MM = [0.7, 1.0, 2.0];

export class PulsarX3 {
  constructor(public session: Session) {}

  // ── Identity ───────────────────────────────────────────────────────────

  /** (0x01, 0x04, 0x04): the paired mouse's cabled VID/PID, LE at bytes 6..9. Dongle only. */
  async getPairedMouse(): Promise<PairedMouse> {
    const r = await this.session.read({ cat: 0x01, reg: 0x04, sub: 0x04 });
    return { vid: u16le(r, 6), pid: u16le(r, 8) };
  }

  /** (0x01, 0x07, 0x04): mouse firmware, bytes 6..7. Read 0x16 0x10 on a unit Fusion labels 1.0.16. */
  async getFirmware(): Promise<string> {
    const r = await this.session.read({ cat: 0x01, reg: 0x07, sub: 0x04 });
    return `${r[7] >> 4}.${r[7] & 0x0f}.${r[6].toString(16)}`;
  }

  // ── Power (cat 0x08) ───────────────────────────────────────────────────

  /** (0x08, 0x01, 0x01) byte 6 = battery %, 0xFF when the dongle has no mouse. (0x08, 0x03, 0x01) byte 6 = charging flag. */
  async getPower(): Promise<PowerStatus> {
    const b = await this.session.read({ cat: 0x08, reg: 0x01, sub: 0x01 });
    const c = await this.session.read({ cat: 0x08, reg: 0x03, sub: 0x01 });
    return { batteryPercent: b[6] === 0xff ? null : b[6], charging: c[6] !== 0 };
  }

  /** (0x08, 0x05, 0x03) bytes 7..8 = sleep timer, uint16 LE seconds. */
  async getSleepTimer(): Promise<number> {
    const r = await this.session.read({ cat: 0x08, reg: 0x05, sub: 0x03 });
    return u16le(r, 7);
  }
  async setSleepTimer(seconds: number): Promise<void> {
    assertRange(seconds, SLEEP_MIN_S, SLEEP_MAX_S, 'sleep timer (s)');
    await this.session.write({ cat: 0x08, reg: 0x05, sub: 0x03, payload: u16leBytes(seconds) });
  }

  /** (0x08, 0x08, 0x02) byte 7 = Low Power Mode threshold in %. */
  async getLowPowerThreshold(): Promise<number> {
    const r = await this.session.read({ cat: 0x08, reg: 0x08, sub: 0x02 });
    return r[7];
  }
  async setLowPowerThreshold(percent: number): Promise<void> {
    assertRange(percent, 0, 100, 'low power threshold');
    await this.session.write({ cat: 0x08, reg: 0x08, sub: 0x02, payload: [percent] });
  }

  // ── Performance ────────────────────────────────────────────────────────

  /** (0x01, 0x09, 0x02) byte 7 = polling bitmask (0x08 = 1000 Hz). */
  async getPollingRate(): Promise<number | null> {
    const r = await this.session.read({ cat: 0x01, reg: 0x09, sub: 0x02 });
    return POLL_VAL_TO_HZ[r[7]] ?? null;
  }
  async setPollingRate(hz: number): Promise<void> {
    const v = POLL_HZ_TO_VAL[hz];
    if (v === undefined) throw new RangeError(`unsupported polling rate ${hz}`);
    await this.session.write({ cat: 0x01, reg: 0x09, sub: 0x02, payload: [v] });
  }

  /** (0x04, 0x03, 0x03) byte 7 = debounce in ms. */
  async getDebounce(): Promise<number> {
    const r = await this.session.read({ cat: 0x04, reg: 0x03, sub: 0x03 });
    return r[7];
  }
  async setDebounce(ms: number): Promise<void> {
    assertRange(ms, DEBOUNCE_MIN, DEBOUNCE_MAX, 'debounce (ms)');
    await this.session.write({ cat: 0x04, reg: 0x03, sub: 0x03, payload: [ms] });
  }

  /** (0x07, 0x02, 0x03) payload [0x02, mm*10]; read byte 8 = mm*10. Per profile. */
  async getLod(profile = PROFILE): Promise<number> {
    const r = await this.session.read({ cat: 0x07, reg: 0x02, sub: 0x03, profile });
    return r[8] / 10;
  }
  async setLod(mm: number, profile = PROFILE): Promise<void> {
    const raw = Math.round(mm * 10);
    assertRange(raw, 7, 20, 'LOD (mm*10)');
    await this.session.write({ cat: 0x07, reg: 0x02, sub: 0x03, profile, payload: [0x02, raw] });
  }

  /** (0x07, 0x03/0x04/0x05, 0x02) byte 7 = 0/1 for ripple control / angle snap / motion sync. */
  getRippleControl() { return this.getFlag(0x03); }
  setRippleControl(on: boolean) { return this.setFlag(0x03, on); }
  getAngleSnap() { return this.getFlag(0x04); }
  setAngleSnap(on: boolean) { return this.setFlag(0x04, on); }
  getMotionSync() { return this.getFlag(0x05); }
  setMotionSync(on: boolean) { return this.setFlag(0x05, on); }

  private async getFlag(reg: number): Promise<boolean> {
    const r = await this.session.read({ cat: 0x07, reg, sub: 0x02 });
    return r[7] !== 0;
  }
  private async setFlag(reg: number, on: boolean): Promise<void> {
    await this.session.write({ cat: 0x07, reg, sub: 0x02, payload: [on ? 1 : 0] });
  }

  // ── DPI (cat 0x05) ─────────────────────────────────────────────────────

  /**
   * (0x05, 0x04, 0x15) read → byte 7 = active stage, byte 8 = stage count,
   * then per stage 5 bytes: [index, xLo, xHi, yLo, yHi]. The device answers
   * with sub 0x0d or 0x21, so sub is not compared.
   */
  async getDpiStages(profile = PROFILE): Promise<DpiStages> {
    const r = await this.session.read({ cat: 0x05, reg: 0x04, sub: 0x15, profile });
    const active = r[7];
    const count = Math.min(r[8], MAX_DPI_STAGES);
    const stages = [];
    for (let i = 0; i < count; i++) {
      const base = 9 + i * 5;
      stages.push({ x: u16le(r, base + 1), y: u16le(r, base + 3) });
    }
    return { active, stages };
  }

  /** (0x05, 0x04, 0x21) write, payload [active, count, (i, xLo, xHi, yLo, yHi)...]. */
  async setDpiStages(stages: { x: number; y: number }[], active: number, profile = PROFILE): Promise<void> {
    if (stages.length < 1 || stages.length > MAX_DPI_STAGES) throw new RangeError(`1–${MAX_DPI_STAGES} stages`);
    assertRange(active, 1, stages.length, 'active stage');
    for (const s of stages) {
      assertRange(s.x, DPI_MIN, DPI_MAX, 'DPI');
      assertRange(s.y, DPI_MIN, DPI_MAX, 'DPI');
    }
    const payload: number[] = [active, stages.length];
    stages.forEach((s, i) => payload.push(i + 1, ...u16leBytes(s.x), ...u16leBytes(s.y)));
    await this.session.write({ cat: 0x05, reg: 0x04, sub: 0x21, profile, payload });
  }

  /** (0x05, 0x01, 0x02) byte 7 = active DPI stage (1-based). Works with profile 0 or 1. */
  async getActiveDpiStage(): Promise<number> {
    const r = await this.session.read({ cat: 0x05, reg: 0x01, sub: 0x02, profile: PROFILE });
    return r[7];
  }
  async setActiveDpiStage(stage: number): Promise<void> {
    assertRange(stage, 1, MAX_DPI_STAGES, 'DPI stage');
    await this.session.write({ cat: 0x05, reg: 0x01, sub: 0x02, profile: PROFILE, payload: [stage] });
  }

  /** (0x05, 0x02, 0x05) bytes 7..8 = current X DPI, 9..10 = Y. */
  async getCurrentDpi(): Promise<{ x: number; y: number }> {
    const r = await this.session.read({ cat: 0x05, reg: 0x02, sub: 0x05 });
    return { x: u16le(r, 7), y: u16le(r, 9) };
  }

  /** (0x05, 0x05, 0x05) payload [stage] → bytes 8..10 = RGB. Only stage 1 answered on the X3 (no RGB LED). */
  async getStageColor(stage: number, profile = PROFILE): Promise<[number, number, number]> {
    const r = await this.session.read({ cat: 0x05, reg: 0x05, sub: 0x05, profile, payload: [stage] });
    return [r[8], r[9], r[10]];
  }

  // ── Buttons (cat 0x04) ─────────────────────────────────────────────────

  /** (0x04, 0x01, 0x06) read payload [buttonId, 0xff] → bytes 8..10 = [type, a1, a2]. */
  async getButton(buttonId: number, profile = PROFILE): Promise<Binding> {
    const r = await this.session.read({ cat: 0x04, reg: 0x01, sub: 0x06, profile, payload: [buttonId, 0xff] });
    return { type: r[8], a1: r[9], a2: r[10] };
  }
  /** (0x04, 0x01, 0x06) write payload [buttonId, type, a1, a2]. */
  async setButton(buttonId: number, b: Binding, profile = PROFILE): Promise<void> {
    await this.session.write({ cat: 0x04, reg: 0x01, sub: 0x06, profile, payload: [buttonId, b.type, b.a1, b.a2] });
  }

  // ── Factory reset ──────────────────────────────────────────────────────

  /**
   * (0x02, 0x05, 0x01) then (0x02, 0x06, 0x01), as captured from Fusion on
   * an X2A. On that mouse it resets the given profile AND every global
   * setting. NOT exercised on the X3; the second frame may not be answered.
   */
  async factoryReset(profile = PROFILE): Promise<void> {
    await this.session.write({ cat: 0x02, reg: 0x05, sub: 0x01, profile });
    try {
      await this.session.write({ cat: 0x02, reg: 0x06, sub: 0x01, profile }, { timeoutMs: 500 });
    } catch (e) {
      if (!(e instanceof ProtocolError)) throw e;
    }
  }
}

function assertRange(v: number, lo: number, hi: number, what: string) {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new RangeError(`${what} must be an integer ${lo}–${hi}, got ${v}`);
}
