import { MockTransport, answer, frame, pendingEcho } from './mock-transport';
import type { FeatureTransport } from './transport';

/**
 * Replies captured from a real Pulsar X3 on the 1K dongle (3710:5402),
 * 2026-10-13. Keyed by "cat reg" of the request.
 */
export const CAPTURED: Record<string, string> = {
  '01 84': '01 01 84 04 00 00 10 37 09 34',
  '01 87': '01 01 87 04 00 00 16 10',
  '08 81': '01 08 81 01 00 00 33',
  '08 83': '01 08 83 01 00 00 00',
  '08 85': '01 08 85 03 00 00 00 1e 00',
  '08 88': '01 08 88 02 00 00 00 0a',
  '01 89': '01 01 89 02 00 00 00 08',
  '04 83': '01 04 83 03 00 00 00 02',
  '07 84': '01 07 84 02 00 00 00 00',
  '07 83': '01 07 83 02 00 00 00 00',
  '07 85': '01 07 85 02 00 00 00 01',
  '07 82': '01 07 82 03 00 00 01 02 0a',
  '05 84': '01 05 84 0d 00 00 01 02 02 01 90 01 90 01 02 20 03 20 03 00 00 00 00 06 04 80 0c 80 0c 05 00 19 00 19 06 00 32 00 32',
  '05 81': '01 05 81 02 00 00 01 02',
  '05 82': '01 05 82 05 00 00 00 20 03 20 03',
  '04 81': '01 04 81 06 00 00 01 0b 09 03 00',
};

/** Per-button answers to (0x04, 0x81, 0x06) [buttonId, ff], captured on the same mouse. */
export const CAPTURED_BUTTONS: Record<number, string> = {
  0x01: '01 04 81 06 00 00 01 01 01 01 00',
  0x02: '01 04 81 06 00 00 01 02 01 02 00',
  0x03: '01 04 81 06 00 00 01 03 01 03 00',
  0x04: '01 04 81 06 00 00 01 04 01 04 00',
  0x05: '01 04 81 06 00 00 01 05 01 05 00',
  0x0b: '01 04 81 06 00 00 01 0b 09 03 00',
};

function keyOf(cmd: Uint8Array): string {
  return `${cmd[1].toString(16).padStart(2, '0')} ${(cmd[2] | 0x80).toString(16).padStart(2, '0')}`;
}

/** Stateless transport that answers every read with the captured frame. */
export function capturedTransport(): MockTransport {
  return new MockTransport((cmd) => {
    const isRead = (cmd[2] & 0x80) !== 0;
    const rsp = !isRead ? undefined : cmd[1] === 0x04 && (cmd[2] & 0x7f) === 0x01 ? CAPTURED_BUTTONS[cmd[7]] : CAPTURED[keyOf(cmd)];
    return rsp ? [pendingEcho(cmd), frame(rsp)] : [pendingEcho(cmd), answer(cmd, [cmd[6]])];
  });
}

const DPI_TABLE = '5:4';
const DPI_ACTIVE = '5:1';

/**
 * Stateful fake mouse for the `?demo` page: starts from the captured
 * values and remembers writes, so the UI round-trips without hardware.
 *
 * It mirrors the couplings verified on the real X3: writing the DPI table
 * selects its active stage, writing the active stage updates byte 7 of the
 * table, and the current-DPI register follows whichever stage is active.
 */
export class DemoTransport implements FeatureTransport {
  private state = new Map<string, Uint8Array>();
  private pending: Uint8Array[] = [];

  private stateKey(cmd: Uint8Array): string {
    const reg = cmd[2] & 0x7f;
    const extra = cmd[1] === 0x04 && reg === 0x01 ? `:${cmd[7]}` : '';
    return `${cmd[1]}:${reg}${extra}`;
  }

  /** The DPI table as the mouse would answer it from byte 7: [active, count, (i, xLo, xHi, yLo, yHi)…]. */
  private dpiTable(): Uint8Array {
    const table = new Uint8Array(this.state.get(DPI_TABLE) ?? frame(CAPTURED['05 84']).subarray(7));
    const active = this.state.get(DPI_ACTIVE);
    if (active) table[0] = active[0];
    return table;
  }

  async sendFeature(cmd: Uint8Array): Promise<void> {
    const isRead = (cmd[2] & 0x80) !== 0;
    const key = this.stateKey(cmd);
    if (!isRead) {
      this.state.set(key, cmd.slice(7, 62));
      if (key === DPI_TABLE) this.state.set(DPI_ACTIVE, cmd.slice(7, 8));
      this.pending = [pendingEcho(cmd), answer(cmd, Array.from(cmd.subarray(6, 62)))];
      return;
    }
    if (key === DPI_TABLE) {
      const r = answer(cmd, [cmd[6]]);
      r.set(this.dpiTable(), 7);
      this.pending = [pendingEcho(cmd), r];
      return;
    }
    if (key === '5:2') {
      const table = this.dpiTable();
      const off = 2 + (table[0] - 1) * 5 + 1;
      this.pending = [pendingEcho(cmd), answer(cmd, [cmd[6], table[off], table[off + 1], table[off + 2], table[off + 3]])];
      return;
    }
    const stored = this.state.get(key);
    if (stored) {
      const r = answer(cmd, [cmd[6]]);
      r.set(stored, 7);
      this.pending = [pendingEcho(cmd), r];
      return;
    }
    const rsp = cmd[1] === 0x04 && (cmd[2] & 0x7f) === 0x01 ? CAPTURED_BUTTONS[cmd[7]] : CAPTURED[keyOf(cmd)];
    this.pending = rsp ? [pendingEcho(cmd), frame(rsp)] : [pendingEcho(cmd), answer(cmd, [cmd[6]])];
  }

  async receiveFeature(): Promise<Uint8Array> {
    if (this.pending.length === 0) return new Uint8Array(64);
    return this.pending.length > 1 ? this.pending.shift()! : this.pending[0];
  }
}
