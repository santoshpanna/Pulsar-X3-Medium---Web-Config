import { describe, expect, it } from 'vitest';
import { MockTransport, answer, pendingEcho } from './mock-transport';
import { buildPacket } from './packet';
import { ProtocolError, Session } from './transport';

describe('Session.transact', () => {
  it('polls through the pending echo until the 0x01 answer arrives', async () => {
    const t = new MockTransport((cmd) => [pendingEcho(cmd), pendingEcho(cmd), answer(cmd, [0x33])]);
    const s = new Session(t, { pollMs: 1 });
    const r = await s.read({ cat: 0x08, reg: 0x01, sub: 0x01 });
    expect(r[0]).toBe(0x01);
    expect(r[6]).toBe(0x33);
  });

  it('ignores a stale answer for a different register', async () => {
    const stale = answer(buildPacket({ cat: 0x03, reg: 0x04, sub: 0x0f, profile: 1 }, true), [1, 1]);
    const t = new MockTransport((cmd) => [stale, answer(cmd, [0x50])]);
    const s = new Session(t, { pollMs: 1 });
    const r = await s.read({ cat: 0x08, reg: 0x01, sub: 0x01 });
    expect(r[6]).toBe(0x50);
  });

  it('requires the profile byte to echo for per-profile requests', async () => {
    const t = new MockTransport((cmd) => {
      const wrong = answer(cmd, [0x02, 0x99]); // profile 2
      return [wrong, answer(cmd, [0x01, 0x42])];
    });
    const s = new Session(t, { pollMs: 1 });
    const r = await s.read({ cat: 0x07, reg: 0x02, sub: 0x03, profile: 1 });
    expect(r[7]).toBe(0x42);
  });

  it('maps status 0x03/0x04 to a nak and 0x05 to unreachable', async () => {
    for (const [status, code] of [[0x03, 'nak'], [0x04, 'nak'], [0x05, 'unreachable']] as const) {
      const t = new MockTransport((cmd) => { const r = pendingEcho(cmd); r[0] = status; return [r]; });
      const s = new Session(t, { pollMs: 1, timeoutMs: 50 });
      await expect(s.read({ cat: 0x05, reg: 0x05, sub: 0x05 })).rejects.toMatchObject({ code } satisfies Partial<ProtocolError>);
    }
  });

  it('treats endless pending echoes of our request as an asleep mouse', async () => {
    const t = new MockTransport((cmd) => [pendingEcho(cmd)]);
    const s = new Session(t, { pollMs: 1, timeoutMs: 20 });
    await expect(s.read({ cat: 0x08, reg: 0x01, sub: 0x01 })).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('times out when the only traffic does not echo our request', async () => {
    const other = pendingEcho(buildPacket({ cat: 0x03, reg: 0x04, sub: 0x0f }, true));
    const t = new MockTransport(() => [other]);
    const s = new Session(t, { pollMs: 1, timeoutMs: 20 });
    await expect(s.read({ cat: 0x08, reg: 0x01, sub: 0x01 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('serialises concurrent commands so the dongle never sees two in flight', async () => {
    const order: string[] = [];
    const t = new MockTransport((cmd) => {
      order.push(`tx${cmd[2].toString(16)}`);
      return [pendingEcho(cmd), answer(cmd, [cmd[2]])];
    });
    const s = new Session(t, { pollMs: 1 });
    const [a, b, c] = await Promise.all([
      s.read({ cat: 1, reg: 0x01, sub: 1 }),
      s.read({ cat: 1, reg: 0x02, sub: 1 }),
      s.read({ cat: 1, reg: 0x03, sub: 1 }),
    ]);
    expect(order).toEqual(['tx81', 'tx82', 'tx83']);
    expect([a[6], b[6], c[6]]).toEqual([0x81, 0x82, 0x83]);
    expect(t.sent.length).toBe(3);
  });

  it('keeps the queue alive after a failure', async () => {
    let n = 0;
    const t = new MockTransport((cmd) => (n++ === 0 ? [pendingEcho(cmd)] : [answer(cmd, [7])]));
    const s = new Session(t, { pollMs: 1, timeoutMs: 10 });
    await expect(s.read({ cat: 1, reg: 1, sub: 1 })).rejects.toBeInstanceOf(ProtocolError);
    const r = await s.read({ cat: 1, reg: 1, sub: 1 });
    expect(r[6]).toBe(7);
  });
});
