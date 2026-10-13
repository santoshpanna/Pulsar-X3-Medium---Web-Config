import { Dir, REPORT_SIZE, buildPacket, hex, normaliseReport, type Command } from './packet';

/** Minimal feature-report transport. Implemented over WebHID; mockable in tests. */
export interface FeatureTransport {
  sendFeature(data: Uint8Array): Promise<void>;
  receiveFeature(): Promise<Uint8Array>;
}

export type ProtocolErrorCode = 'timeout' | 'nak' | 'unreachable' | 'disconnected';

export class ProtocolError extends Error {
  constructor(public code: ProtocolErrorCode, message: string, public lastFrame?: Uint8Array) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export interface TransactOptions {
  /** Give up after this long. The mouse may be asleep; Fusion waits ~1 s. */
  timeoutMs?: number;
  /** Re-poll the pending reply this often. Fusion polls every 15–30 ms. */
  pollMs?: number;
}

export interface TraceEntry {
  dir: 'tx' | 'rx';
  bytes: Uint8Array;
  note?: string;
  t: number;
}
export type TraceSink = (entry: TraceEntry) => void;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function where(cmd: Uint8Array): string {
  return `cat=0x${cmd[1].toString(16).padStart(2, '0')} reg=0x${cmd[2].toString(16).padStart(2, '0')} sub=0x${cmd[3].toString(16).padStart(2, '0')}`;
}

/**
 * One request/response exchange, serialised through a queue.
 *
 * Over the dongle every command is a radio round trip: after a SET_REPORT
 * the GET_REPORT echoes the request with byte 0 = 0x02 until the mouse has
 * answered, then returns the answer with byte 0 = 0x01. A second SET_REPORT
 * issued while one is pending is dropped by the dongle, so all traffic is
 * funnelled through a single promise chain.
 */
export class Session {
  private queue: Promise<unknown> = Promise.resolve();
  trace?: TraceSink;

  constructor(private transport: FeatureTransport, private defaults: TransactOptions = {}) {}

  read(cmd: Command, opts?: TransactOptions): Promise<Uint8Array> {
    return this.transact(buildPacket(cmd, true), opts);
  }

  write(cmd: Command, opts?: TransactOptions): Promise<Uint8Array> {
    return this.transact(buildPacket(cmd, false), opts);
  }

  transact(packet: Uint8Array, opts?: TransactOptions): Promise<Uint8Array> {
    const run = () => this.transactNow(packet, opts);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async transactNow(cmd: Uint8Array, opts: TransactOptions = {}): Promise<Uint8Array> {
    const timeoutMs = opts.timeoutMs ?? this.defaults.timeoutMs ?? 1000;
    const pollMs = opts.pollMs ?? this.defaults.pollMs ?? 10;
    if (cmd.length !== REPORT_SIZE) throw new RangeError('command must be 64 bytes');

    this.trace?.({ dir: 'tx', bytes: cmd, t: performance.now() });
    await this.transport.sendFeature(cmd);

    const deadline = performance.now() + timeoutMs;
    let last: Uint8Array | undefined;
    let sawPending = false;
    for (;;) {
      const rsp = normaliseReport(await this.transport.receiveFeature());
      last = rsp;
      const echoes = rsp[1] === cmd[1] && rsp[2] === cmd[2];
      const profileOk = cmd[6] === 0 || rsp[6] === cmd[6];
      if (rsp[0] === Dir.Rsp && echoes && profileOk) {
        this.trace?.({ dir: 'rx', bytes: rsp, t: performance.now() });
        return rsp;
      }
      if ((rsp[0] === Dir.Error3 || rsp[0] === Dir.Error4) && echoes) {
        this.trace?.({ dir: 'rx', bytes: rsp, note: 'nak', t: performance.now() });
        throw new ProtocolError('nak', `device rejected ${where(cmd)} (status 0x${rsp[0].toString(16)})`, rsp);
      }
      if (rsp[0] === Dir.Unreachable && echoes) {
        this.trace?.({ dir: 'rx', bytes: rsp, note: 'unreachable', t: performance.now() });
        throw new ProtocolError('unreachable', asleepMessage(cmd), rsp);
      }
      // 0x02 is the dongle echoing our request while it waits on the mouse.
      // Seeing it proves the dongle is relaying, so this IS the right
      // interface; if it never resolves, the mouse is simply asleep.
      if (rsp[0] === Dir.Pending && echoes) sawPending = true;
      if (performance.now() >= deadline) {
        if (sawPending) {
          this.trace?.({ dir: 'rx', bytes: rsp, note: 'asleep', t: performance.now() });
          throw new ProtocolError('unreachable', asleepMessage(cmd), last);
        }
        this.trace?.({ dir: 'rx', bytes: rsp, note: 'timeout', t: performance.now() });
        throw new ProtocolError('timeout', `no answer to ${where(cmd)} within ${timeoutMs} ms (last: ${hex(last, 8)}). Is the mouse awake and paired?`, last);
      }
      await sleep(pollMs);
    }
  }
}

function asleepMessage(cmd: Uint8Array): string {
  return `the mouse is asleep or out of range (no reply to ${where(cmd)}). Move the mouse to wake it.`;
}
