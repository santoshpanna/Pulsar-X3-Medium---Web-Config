import { describe, expect, it } from 'vitest';
import { buildPacket, checksum, hex, normaliseReport, parsePacket, u16le, u16leBytes } from './packet';

describe('buildPacket', () => {
  it('frames a read with bit 7 set and a LE sum checksum', () => {
    const p = buildPacket({ cat: 0x08, reg: 0x01, sub: 0x01 }, true);
    expect(p.length).toBe(64);
    expect(Array.from(p.subarray(0, 7))).toEqual([0x00, 0x08, 0x81, 0x01, 0x00, 0x00, 0x00]);
    // 0x08 + 0x81 + 0x01 = 0x8a
    expect(p[62]).toBe(0x8a);
    expect(p[63]).toBe(0x00);
  });

  it('frames the DPI-stage write exactly as the Linux driver and Fusion do', () => {
    const payload = [2, 2, 1, 0x90, 0x01, 0x90, 0x01, 2, 0x20, 0x03, 0x20, 0x03];
    const p = buildPacket({ cat: 0x05, reg: 0x04, sub: 0x21, profile: 1, payload });
    expect(hex(p, 19)).toBe('00 05 04 21 00 00 01 02 02 01 90 01 90 01 02 20 03 20 03');
    expect(checksum(p)).toBe(u16le(p, 62));
  });

  it('clears bit 7 on writes and rejects oversized payloads', () => {
    expect(buildPacket({ cat: 1, reg: 0x89, sub: 2 })[2]).toBe(0x09);
    expect(() => buildPacket({ cat: 1, reg: 1, sub: 1, payload: new Array(60).fill(0) })).toThrow(RangeError);
  });
});

describe('normaliseReport / parsePacket', () => {
  it('drops the report-ID prefix WebHID adds on receive', () => {
    const withId = new Uint8Array(65);
    withId[1] = 0x01; withId[2] = 0x08; withId[3] = 0x81; withId[7] = 0x33;
    const dv = new DataView(withId.buffer);
    const f = parsePacket(dv);
    expect(f.raw.length).toBe(64);
    expect(f.dir).toBe(0x01);
    expect(f.cat).toBe(0x08);
    expect(f.reg).toBe(0x81);
    expect(f.raw[6]).toBe(0x33);
  });

  it('pads short buffers', () => {
    expect(normaliseReport(new Uint8Array([1, 2, 3])).length).toBe(64);
  });

  it('round-trips u16', () => {
    expect(u16leBytes(800)).toEqual([0x20, 0x03]);
    expect(u16le([0x20, 0x03], 0)).toBe(800);
  });
});
