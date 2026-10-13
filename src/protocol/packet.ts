/**
 * Pulsar "Fusion2" (Sonix MCU) 64-byte HID Feature Report framing.
 *
 * Used by the Pulsar X3 (wired PID 0x3409 / 0x3410), the 1K wireless dongle
 * (PID 0x5402), the 8K dongle (0x5403), the X2A, Xlite v4 and friends.
 *
 *   byte  0     direction: 0x00 = command (host→device)
 *                          0x01 = answer   (device→host)
 *                          0x02 = pending  (dongle still waiting on the mouse)
 *                          0x03 / 0x04 = error / unsupported register (observed)
 *                          0x05 = mouse not reachable (asleep / out of range)
 *   byte  1     category
 *   byte  2     register   (bit 7 set = read, clear = write)
 *   byte  3     sub-register
 *   bytes 4-5   always 0x00
 *   byte  6     profile: 0 = "the active profile", 1..5 = a stored profile
 *   bytes 7-61  payload
 *   bytes 62-63 checksum: little-endian uint16 of sum(bytes[0..61])
 */

export const REPORT_SIZE = 64;
export const REPORT_ID = 0;
export const PAYLOAD_OFFSET = 7;

export const Dir = {
  Cmd: 0x00,
  Rsp: 0x01,
  Pending: 0x02,
  Error3: 0x03,
  Error4: 0x04,
  Unreachable: 0x05,
} as const;

export interface Command {
  cat: number;
  reg: number;
  sub: number;
  profile?: number;
  payload?: ArrayLike<number>;
}

export interface Frame {
  dir: number;
  cat: number;
  reg: number;
  sub: number;
  profile: number;
  /** bytes 7..61 */
  payload: Uint8Array;
  /** the whole 64-byte frame */
  raw: Uint8Array;
  checksumOk: boolean;
}

export function checksum(buf: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 62; i++) sum += buf[i];
  return sum & 0xffff;
}

/** Build a 64-byte command frame. Set `read` to flip bit 7 of the register. */
export function buildPacket(cmd: Command, read = false): Uint8Array {
  const buf = new Uint8Array(REPORT_SIZE);
  buf[0] = Dir.Cmd;
  buf[1] = cmd.cat & 0xff;
  buf[2] = (read ? cmd.reg | 0x80 : cmd.reg & 0x7f) & 0xff;
  buf[3] = cmd.sub & 0xff;
  buf[6] = (cmd.profile ?? 0) & 0xff;
  const payload = cmd.payload ?? [];
  if (payload.length > 62 - PAYLOAD_OFFSET) throw new RangeError('payload too long');
  for (let i = 0; i < payload.length; i++) buf[PAYLOAD_OFFSET + i] = payload[i] & 0xff;
  const cs = checksum(buf);
  buf[62] = cs & 0xff;
  buf[63] = cs >> 8;
  return buf;
}

/**
 * Normalise a received buffer to exactly 64 bytes. WebHID's
 * receiveFeatureReport() prepends the report ID byte (giving 65 bytes);
 * hidapi on Windows does the same. Drop it when present.
 */
export function normaliseReport(data: Uint8Array | DataView | ArrayBuffer): Uint8Array {
  let bytes: Uint8Array;
  if (data instanceof DataView) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else bytes = data;
  if (bytes.length === REPORT_SIZE + 1) bytes = bytes.subarray(1);
  if (bytes.length < REPORT_SIZE) {
    const padded = new Uint8Array(REPORT_SIZE);
    padded.set(bytes);
    bytes = padded;
  }
  return bytes.subarray(0, REPORT_SIZE);
}

export function parsePacket(data: Uint8Array | DataView | ArrayBuffer): Frame {
  const raw = normaliseReport(data);
  const cs = raw[62] | (raw[63] << 8);
  return {
    dir: raw[0],
    cat: raw[1],
    reg: raw[2],
    sub: raw[3],
    profile: raw[6],
    payload: raw.subarray(PAYLOAD_OFFSET, 62),
    raw,
    checksumOk: cs === checksum(raw),
  };
}

export function u16le(buf: ArrayLike<number>, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

export function u16leBytes(v: number): [number, number] {
  return [v & 0xff, (v >> 8) & 0xff];
}

export function hex(buf: ArrayLike<number>, max = buf.length): string {
  const parts: string[] = [];
  for (let i = 0; i < Math.min(max, buf.length); i++) parts.push(buf[i].toString(16).padStart(2, '0'));
  return parts.join(' ');
}
