import { REPORT_SIZE } from './packet';
import type { FeatureTransport } from './transport';

/** Parse "01 08 81 01 00 00 33" style hex into a 64-byte frame. */
export function frame(hexStr: string): Uint8Array {
  const buf = new Uint8Array(REPORT_SIZE);
  hexStr.trim().split(/\s+/).forEach((h, i) => { buf[i] = parseInt(h, 16); });
  return buf;
}

export type Scripted = (sent: Uint8Array) => Uint8Array[];

/**
 * Fake dongle: for each sent command the script returns the sequence of
 * GET_REPORT replies (e.g. a pending echo followed by the answer). The
 * last reply is repeated if polled further.
 */
export class MockTransport implements FeatureTransport {
  sent: Uint8Array[] = [];
  private pending: Uint8Array[] = [];
  constructor(private script: Scripted) {}

  async sendFeature(data: Uint8Array): Promise<void> {
    this.sent.push(new Uint8Array(data));
    this.pending = this.script(data);
  }

  async receiveFeature(): Promise<Uint8Array> {
    if (this.pending.length === 0) return new Uint8Array(REPORT_SIZE);
    const r = this.pending.length > 1 ? this.pending.shift()! : this.pending[0];
    return r;
  }
}

/** The dongle's "still waiting on the mouse" echo of a command. */
export function pendingEcho(cmd: Uint8Array): Uint8Array {
  const r = new Uint8Array(cmd);
  r[0] = 0x02;
  return r;
}

/** An answer frame echoing cat/reg/sub/profile of the command, with the given bytes from offset 6. */
export function answer(cmd: Uint8Array, fromByte6: number[]): Uint8Array {
  const r = new Uint8Array(REPORT_SIZE);
  r[0] = 0x01; r[1] = cmd[1]; r[2] = cmd[2]; r[3] = cmd[3]; r[6] = cmd[6];
  fromByte6.forEach((b, i) => { r[6 + i] = b; });
  return r;
}
