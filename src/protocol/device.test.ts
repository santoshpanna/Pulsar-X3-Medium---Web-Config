import { describe, expect, it } from 'vitest';
import { BtnType, describeBinding, findOptionId, keyboardBinding } from './buttons';
import { PulsarX3 } from './device';
import { DemoTransport, capturedTransport as captured } from './captured';
import { MockTransport, answer } from './mock-transport';
import { hex } from './packet';
import { Session } from './transport';

function dev(t: MockTransport) {
  return new PulsarX3(new Session(t, { pollMs: 1 }));
}

describe('PulsarX3 reads (captured frames)', () => {
  it('decodes identity, power and sensor registers', async () => {
    const d = dev(captured());
    expect(await d.getPairedMouse()).toEqual({ vid: 0x3710, pid: 0x3409 });
    expect(await d.getFirmware()).toBe('1.0.16');
    expect(await d.getPower()).toEqual({ batteryPercent: 51, charging: false });
    expect(await d.getSleepTimer()).toBe(30);
    expect(await d.getLowPowerThreshold()).toBe(10);
    expect(await d.getPollingRate()).toBe(1000);
    expect(await d.getDebounce()).toBe(2);
    expect(await d.getAngleSnap()).toBe(false);
    expect(await d.getRippleControl()).toBe(false);
    expect(await d.getMotionSync()).toBe(true);
    expect(await d.getLod()).toBe(1.0);
  });

  it('decodes DPI stages, honouring the stage count', async () => {
    const d = dev(captured());
    expect(await d.getDpiStages()).toEqual({ active: 2, stages: [{ x: 400, y: 400 }, { x: 800, y: 800 }] });
    expect(await d.getActiveDpiStage()).toBe(2);
    expect(await d.getCurrentDpi()).toEqual({ x: 800, y: 800 });
  });

  it('decodes a button binding', async () => {
    const d = dev(captured());
    const b = await d.getButton(0x0b);
    expect(b).toEqual({ type: BtnType.Dpi, a1: 3, a2: 0 });
    expect(describeBinding(b)).toBe('DPI cycle');
    expect(findOptionId(b)).toBe('dpiloop');
  });

  it('reports no battery when the dongle answers 0xFF', async () => {
    const t = new MockTransport((cmd) => [answer(cmd, [0xff])]);
    expect((await dev(t).getPower()).batteryPercent).toBeNull();
  });
});

describe('PulsarX3 writes (frames on the wire)', () => {
  it('encodes the registers byte-for-byte like Fusion', async () => {
    const t = captured();
    const d = dev(t);
    await d.setPollingRate(500);
    await d.setDebounce(3);
    await d.setLod(2.0);
    await d.setSleepTimer(60);
    await d.setLowPowerThreshold(15);
    await d.setMotionSync(false);
    await d.setActiveDpiStage(1);
    await d.setDpiStages([{ x: 400, y: 400 }, { x: 800, y: 800 }], 2);
    await d.setButton(0x04, keyboardBinding(0x01, 0x06)); // Ctrl+C on side-front
    const wire = t.sent.map((p) => hex(p, 19));
    expect(wire).toEqual([
      '00 01 09 02 00 00 00 04 00 00 00 00 00 00 00 00 00 00 00',
      '00 04 03 03 00 00 00 03 00 00 00 00 00 00 00 00 00 00 00',
      '00 07 02 03 00 00 01 02 14 00 00 00 00 00 00 00 00 00 00',
      '00 08 05 03 00 00 00 3c 00 00 00 00 00 00 00 00 00 00 00',
      '00 08 08 02 00 00 00 0f 00 00 00 00 00 00 00 00 00 00 00',
      '00 07 05 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00',
      '00 05 01 02 00 00 01 01 00 00 00 00 00 00 00 00 00 00 00',
      '00 05 04 21 00 00 01 02 02 01 90 01 90 01 02 20 03 20 03',
      '00 04 01 06 00 00 01 04 02 01 06 00 00 00 00 00 00 00 00',
    ]);
  });

  it('round-trips through the stateful demo transport', async () => {
    const d = new PulsarX3(new Session(new DemoTransport(), { pollMs: 1 }));
    expect(await d.getPollingRate()).toBe(1000);
    await d.setPollingRate(500);
    expect(await d.getPollingRate()).toBe(500);
    await d.setDpiStages([{ x: 1600, y: 1600 }, { x: 3200, y: 3200 }, { x: 6400, y: 6400 }], 3);
    expect(await d.getDpiStages()).toEqual({ active: 3, stages: [{ x: 1600, y: 1600 }, { x: 3200, y: 3200 }, { x: 6400, y: 6400 }] });
    expect(await d.getCurrentDpi()).toEqual({ x: 6400, y: 6400 });
    await d.setActiveDpiStage(1);
    expect(await d.getCurrentDpi()).toEqual({ x: 1600, y: 1600 });
    await d.setButton(0x04, keyboardBinding(0x02, 0x3e)); // Shift+F5
    expect(describeBinding(await d.getButton(0x04))).toBe('Shift + F5');
    expect(describeBinding(await d.getButton(0x05))).toBe('Back');
  });

  it('validates ranges before touching the device', async () => {
    const t = captured();
    const d = dev(t);
    await expect(d.setPollingRate(3000)).rejects.toThrow(RangeError);
    await expect(d.setDebounce(99)).rejects.toThrow(RangeError);
    await expect(d.setLod(3)).rejects.toThrow(RangeError);
    await expect(d.setSleepTimer(5)).rejects.toThrow(RangeError);
    await expect(d.setDpiStages([], 1)).rejects.toThrow(RangeError);
    await expect(d.setDpiStages([{ x: 800, y: 800 }], 2)).rejects.toThrow(RangeError);
    await expect(d.setDpiStages([{ x: 40000, y: 800 }], 1)).rejects.toThrow(RangeError);
    expect(t.sent.length).toBe(0);
  });
});
