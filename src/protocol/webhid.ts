import { REPORT_ID, normaliseReport, type Command } from './packet';
import { ProtocolError, Session, type FeatureTransport } from './transport';

export const PULSAR_VID = 0x3710;

/** Known product IDs. The dongles are shared across the Fusion2 line. */
export const KNOWN_PRODUCTS: Record<number, { name: string; wireless: boolean; maxHz: number }> = {
  0x5402: { name: 'Pulsar 1K wireless dongle', wireless: true, maxHz: 1000 },
  0x5403: { name: 'Pulsar 8K wireless dongle', wireless: true, maxHz: 8000 },
  0x3409: { name: 'Pulsar X3 (wired)', wireless: false, maxHz: 8000 },
  0x3410: { name: 'Pulsar X3 (wired)', wireless: false, maxHz: 8000 },
  0x3401: { name: 'Pulsar Xlite v4 (wired)', wireless: false, maxHz: 1000 },
  0x3404: { name: 'Pulsar X2A v3 (wired)', wireless: false, maxHz: 1000 },
  0x1404: { name: 'Pulsar X2A (wired)', wireless: false, maxHz: 1000 },
};

export const MOUSE_NAMES: Record<number, string> = {
  0x3409: 'Pulsar X3',
  0x3410: 'Pulsar X3',
  0x3401: 'Pulsar Xlite v4',
  0x3404: 'Pulsar X2A v3',
  0x1404: 'Pulsar X2A',
};

/** Chrome needs usagePage/usage filters: the config channel is a vendor collection. */
export const HID_FILTERS: HIDDeviceFilter[] = [
  { vendorId: PULSAR_VID, usagePage: 0xffff, usage: 0x0001 },
  // Interface 1 carries unsolicited reports (link quality, DPI change) in
  // two generic-desktop collections with usage 0.
  { vendorId: PULSAR_VID, usagePage: 0x0001, usage: 0x0000 },
];

export function webHidSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator;
}

class WebHidFeatureTransport implements FeatureTransport {
  constructor(public device: HIDDevice) {}
  async sendFeature(data: Uint8Array): Promise<void> {
    if (!this.device.opened) throw new ProtocolError('disconnected', 'device closed');
    // Copy into a plain ArrayBuffer: BufferSource rejects views over SharedArrayBuffer.
    const copy = new Uint8Array(new ArrayBuffer(data.length));
    copy.set(data);
    await this.device.sendFeatureReport(REPORT_ID, copy);
  }
  async receiveFeature(): Promise<Uint8Array> {
    if (!this.device.opened) throw new ProtocolError('disconnected', 'device closed');
    const dv = await this.device.receiveFeatureReport(REPORT_ID);
    return normaliseReport(dv);
  }
}

export type DeviceEvent =
  | { kind: 'signal'; percent: number }
  | { kind: 'dpi'; stage: number; dpi: number }
  | { kind: 'raw'; bytes: Uint8Array };

export interface Connection {
  control: HIDDevice;
  eventDevices: HIDDevice[];
  session: Session;
  productId: number;
  productName: string;
  close(): Promise<void>;
  onEvent(cb: (e: DeviceEvent) => void): () => void;
}

/** Ask the user to pick the mouse / dongle. Must be called from a user gesture. */
export async function requestPulsarDevices(): Promise<HIDDevice[]> {
  return navigator.hid.requestDevice({ filters: HID_FILTERS });
}

/** Devices the user already granted earlier (no gesture needed). */
export async function grantedPulsarDevices(): Promise<HIDDevice[]> {
  const all = await navigator.hid.getDevices();
  return all.filter((d) => d.vendorId === PULSAR_VID);
}

function isControlCollection(d: HIDDevice): boolean {
  return d.collections.some((c) => c.usagePage === 0xffff && (c.featureReports?.length ?? 0) > 0);
}

function isEventCollection(d: HIDDevice): boolean {
  return d.collections.some((c) => c.usagePage === 0x0001 && c.usage === 0x0000);
}

const PROBE: Command = { cat: 0x01, reg: 0x07, sub: 0x04 }; // firmware version: answered by mouse and dongle alike

/**
 * Open the right collection. The dongle exposes two identical-looking
 * vendor collections (interfaces 2 and 3) and only interface 3 answers, so
 * each candidate is probed with a short read.
 */
export async function connect(devices: HIDDevice[]): Promise<Connection> {
  const candidates = devices.filter(isControlCollection);
  if (candidates.length === 0) throw new Error('No Pulsar vendor HID collection found. Pick the mouse or its dongle in the chooser.');

  // Group by physical product so we don't mix a wired mouse with an idle dongle.
  const byPid = new Map<number, HIDDevice[]>();
  for (const d of candidates) byPid.set(d.productId, [...(byPid.get(d.productId) ?? []), d]);

  // The dongle exposes two identical vendor collections and only one answers;
  // the other fails the SET_FEATURE with a Windows "device not functioning"
  // error. Just after a reload, the previous page context's handle to the
  // good collection may still be closing, so that one fails transiently too.
  // Retry the whole group a few times to ride out that race.
  const attempts: string[] = [];
  let writeRefused = 0;
  const RETRIES = 4;
  for (let round = 0; round < RETRIES; round++) {
    attempts.length = 0;
    writeRefused = 0;
    for (const [pid, group] of byPid) {
      for (const [i, dev] of group.entries()) {
        const tag = `entry ${i + 1}/${group.length} (PID 0x${pid.toString(16)}, ${describeCollections(dev)})`;
        try {
          if (!dev.opened) await dev.open();
          const session = new Session(new WebHidFeatureTransport(dev));
          await session.read(PROBE, { timeoutMs: 500 });
          return finishConnection(dev, session, pid, devices);
        } catch (e) {
          // A sleeping mouse still proves this is the right collection.
          if (e instanceof ProtocolError && e.code === 'unreachable') {
            return finishConnection(dev, new Session(new WebHidFeatureTransport(dev)), pid, devices);
          }
          const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          if (/write/i.test(msg)) writeRefused++;
          attempts.push(`${tag} → ${msg}`);
          try { if (dev.opened) await dev.close(); } catch { /* ignore */ }
        }
      }
    }
    if (round < RETRIES - 1) await delay(350);
  }
  const hint = writeRefused > 0 && candidates.length === writeRefused
    ? 'Chrome could not write to the dongle. First close anything else using it: Pulsar Fusion, or another tab or window running this page. If it still fails, unplug the dongle and plug it back in, then reconnect. (A page reload that did not close the connection can leave the dongle stuck in Chrome until it is re-plugged.)'
    : 'No entry answered. If the mouse is asleep, move it, then reconnect.';
  throw new Error(`${hint}\n${attempts.join('\n')}`);
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function describeCollections(d: HIDDevice): string {
  return d.collections.map((c) => {
    const ids = (r: HIDReportInfo[] | undefined) => (r ?? []).map((x) => x.reportId).join(',') || '-';
    return `usage 0x${(c.usagePage ?? 0).toString(16)}:${(c.usage ?? 0).toString(16)} in[${ids(c.inputReports)}] out[${ids(c.outputReports)}] feat[${ids(c.featureReports)}]`;
  }).join(' | ');
}

async function finishConnection(control: HIDDevice, session: Session, pid: number, all: HIDDevice[]): Promise<Connection> {
  const eventDevices: HIDDevice[] = [];
  for (const d of all) {
    if (d.productId !== pid || !isEventCollection(d)) continue;
    try {
      if (!d.opened) await d.open();
      eventDevices.push(d);
    } catch { /* link-quality is optional */ }
  }
  const listeners = new Set<(e: DeviceEvent) => void>();
  const handler = (ev: HIDInputReportEvent) => {
    const b = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
    const parsed = parseEvent(b);
    if (parsed) for (const cb of listeners) cb(parsed);
  };
  for (const d of eventDevices) d.addEventListener('inputreport', handler);

  return {
    control,
    eventDevices,
    session,
    productId: pid,
    productName: KNOWN_PRODUCTS[pid]?.name ?? control.productName ?? `Pulsar 0x${pid.toString(16)}`,
    async close() {
      for (const d of eventDevices) {
        d.removeEventListener('inputreport', handler);
        try { await d.close(); } catch { /* ignore */ }
      }
      try { await control.close(); } catch { /* ignore */ }
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/**
 * Unsolicited reports on interface 1:
 *   05 0d <pct>                     ~1 Hz link quality (dongle)
 *   05 05 <stage0> <dpiLo> <dpiHi>  DPI changed via the button
 *   04 80 00 ...                    ~2 Hz, meaning unknown
 */
export function parseEvent(b: Uint8Array): DeviceEvent | null {
  if (b.length >= 3 && b[0] === 0x05 && b[1] === 0x0d) return { kind: 'signal', percent: b[2] };
  if (b.length >= 5 && b[0] === 0x05 && b[1] === 0x05) return { kind: 'dpi', stage: b[2] + 1, dpi: b[3] | (b[4] << 8) };
  if (b.length >= 2 && b[0] === 0x04 && b[1] === 0x80) return null;
  return { kind: 'raw', bytes: b };
}
