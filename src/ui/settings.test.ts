import { describe, expect, it } from 'vitest';
import { keyboardBinding } from '../protocol/buttons';
import { DemoTransport } from '../protocol/captured';
import { PulsarX3 } from '../protocol/device';
import { MockTransport, answer, pendingEcho } from '../protocol/mock-transport';
import { Session } from '../protocol/transport';
import {
  cloneSettings, diffSettings, exportSettings, importSettings, pickChanges, planWrites, readSettings, runWrites,
  type Settings,
} from './settings';

function demoDevice() {
  return new PulsarX3(new Session(new DemoTransport(), { pollMs: 1 }));
}

describe('diffSettings', () => {
  it('reports nothing for an untouched draft', async () => {
    const s = await readSettings(demoDevice());
    expect(diffSettings(s, cloneSettings(s))).toEqual([]);
  });

  it('names every changed field with before/after text', async () => {
    const base = await readSettings(demoDevice());
    const draft = cloneSettings(base);
    draft.polling = 500;
    draft.debounce = 5;
    draft.lod = 2;
    draft.motionSync = !base.motionSync;
    draft.sleepTimer = 300;
    draft.lowPower = 20;
    draft.dpi.stages.push({ x: 1600, y: 1600 });
    draft.buttons[0x04] = keyboardBinding(0x01, 0x06);
    const d = diffSettings(base, draft);
    expect(d.map((c) => c.key)).toEqual(['dpi', 'polling', 'lod', 'debounce', 'motionSync', 'button:4', 'sleepTimer', 'lowPower']);
    expect(d.find((c) => c.key === 'polling')).toMatchObject({ before: '1000 Hz', after: '500 Hz' });
    expect(d.find((c) => c.key === 'dpi')).toMatchObject({ before: '400 / [800]', after: '400 / [800] / 1600' });
    expect(d.find((c) => c.key === 'button:4')).toMatchObject({ label: 'Side front', before: 'Forward', after: 'Ctrl + C' });
    expect(d.find((c) => c.key === 'sleepTimer')).toMatchObject({ before: '30 s', after: '5 min' });
  });

  it('distinguishes an active-stage change from a table change', async () => {
    const base = await readSettings(demoDevice());
    const draft = cloneSettings(base);
    draft.dpi.active = 1;
    expect(diffSettings(base, draft)).toEqual([
      { key: 'dpiActive', label: 'Active DPI stage', before: 'stage 2 (800 DPI)', after: 'stage 1 (400 DPI)' },
    ]);
  });

  it('ignores currentDpi, which is read-only', async () => {
    const base = await readSettings(demoDevice());
    const draft = cloneSettings(base);
    draft.currentDpi = { x: 1, y: 1 };
    expect(diffSettings(base, draft)).toEqual([]);
  });
});

describe('planWrites + runWrites', () => {
  it('writes only the changed fields, polling last, and the mouse reads back the draft', async () => {
    const t = new DemoTransport();
    const dev = new PulsarX3(new Session(t, { pollMs: 1 }));
    const base = await readSettings(dev);
    const draft = cloneSettings(base);
    draft.polling = 500;
    draft.dpi = { active: 3, stages: [{ x: 800, y: 800 }, { x: 1600, y: 1600 }, { x: 3200, y: 3200 }] };
    draft.buttons[0x05] = keyboardBinding(0x02, 0x3e);
    draft.ripple = true;

    const ops = planWrites(base, draft);
    expect(ops.map((o) => o.key)).toEqual(['dpi', 'ripple', 'button:5', 'polling']);
    expect(await runWrites(dev, ops)).toEqual([]);

    const after = await readSettings(dev);
    expect(diffSettings(draft, after)).toEqual([]);
    expect(after.currentDpi).toEqual({ x: 3200, y: 3200 });
  });

  it('uses the cheap active-stage register when only the active stage moved', async () => {
    const dev = demoDevice();
    const base = await readSettings(dev);
    const draft = cloneSettings(base);
    draft.dpi.active = 1;
    const ops = planWrites(base, draft);
    expect(ops.map((o) => o.key)).toEqual(['dpiActive']);
    await runWrites(dev, ops);
    expect((await readSettings(dev)).currentDpi).toEqual({ x: 400, y: 400 });
  });

  it('records a rejected field and carries on with the rest', async () => {
    // Nak every write to cat 0x04 (debounce / buttons); answer everything else.
    const t = new MockTransport((cmd) => {
      const isWrite = (cmd[2] & 0x80) === 0;
      if (isWrite && cmd[1] === 0x04) { const r = pendingEcho(cmd); r[0] = 0x03; return [r]; }
      return [pendingEcho(cmd), answer(cmd, [cmd[6], 0x08])];
    });
    const dev = new PulsarX3(new Session(t, { pollMs: 1, timeoutMs: 50 }));
    const base = await readSettings(demoDevice());
    const draft = cloneSettings(base);
    draft.debounce = 7;
    draft.sleepTimer = 120;
    const failures = await runWrites(dev, planWrites(base, draft));
    expect(failures.map((f) => f.key)).toEqual(['debounce']);
    expect(t.sent.length).toBe(2);
  });

  it('aborts immediately when the mouse is unreachable', async () => {
    const t = new MockTransport((cmd) => { const r = pendingEcho(cmd); r[0] = 0x05; return [r]; });
    const dev = new PulsarX3(new Session(t, { pollMs: 1, timeoutMs: 50 }));
    const base = await readSettings(demoDevice());
    const draft = cloneSettings(base);
    draft.debounce = 7;
    draft.sleepTimer = 120;
    await expect(runWrites(dev, planWrites(base, draft))).rejects.toMatchObject({ code: 'unreachable' });
    expect(t.sent.length).toBe(1);
  });
});

describe('revert via pickChanges', () => {
  it('puts back exactly the fields an apply touched, leaving later edits alone', async () => {
    const dev = demoDevice();
    const before = await readSettings(dev);
    const draft = cloneSettings(before);
    draft.debounce = 9;
    draft.dpi.active = 1;
    draft.buttons[0x0b] = { type: 0x09, a1: 0x01, a2: 0 };
    const changes = diffSettings(before, draft);
    await runWrites(dev, planWrites(before, draft));
    const applied = await readSettings(dev);
    expect(diffSettings(draft, applied)).toEqual([]);

    // Something unrelated changes on the mouse afterwards (e.g. via the DPI button).
    await dev.setLowPowerThreshold(42);
    const now = await readSettings(dev);

    const revertDraft = pickChanges(now, before, changes);
    expect(revertDraft.lowPower).toBe(42);
    expect(diffSettings(now, revertDraft).map((c) => c.key)).toEqual(['dpiActive', 'debounce', 'button:11']);
    await runWrites(dev, planWrites(now, revertDraft));
    const reverted = await readSettings(dev);
    expect(reverted.debounce).toBe(before.debounce);
    expect(reverted.dpi.active).toBe(before.dpi.active);
    expect(reverted.buttons[0x0b]).toEqual(before.buttons[0x0b]);
    expect(reverted.lowPower).toBe(42);
  });
});

describe('profile files', () => {
  it('round-trips through export and import as a draft', async () => {
    const base = await readSettings(demoDevice());
    const edited = cloneSettings(base);
    edited.polling = 500;
    edited.dpi = { active: 2, stages: [{ x: 400, y: 400 }, { x: 1600, y: 800 }] };
    edited.buttons[0x04] = keyboardBinding(0x01, 0x06);
    const json = JSON.parse(JSON.stringify(exportSettings(edited, 'Pulsar X3')));
    expect(json.dpi.stages).toEqual([400, [1600, 800]]);
    const { draft, skipped } = importSettings(base, json);
    expect(skipped).toEqual([]);
    expect(diffSettings(edited, draft)).toEqual([]);
  });

  it('skips malformed fields instead of failing the whole import', async () => {
    const base = await readSettings(demoDevice());
    const { draft, skipped } = importSettings(base, {
      format: 'pulsar-x3-web-profile', debounce: 'fast', lod: 2, dpi: { stages: ['x'] }, buttons: { left: { type: 1 } },
    });
    expect(skipped).toEqual(['debounce', 'dpi', 'buttons.left']);
    expect(draft.lod).toBe(2);
    expect(draft.debounce).toBe(base.debounce);
  });

  it('rejects files in another format', async () => {
    const base = await readSettings(demoDevice());
    expect(() => importSettings(base, { format: 'something-else' })).toThrow(/Unrecognised/);
  });
});

// Keep the type honest: a Settings literal must include every field.
const _shape: Settings = {
  polling: 1000, debounce: 2, lod: 1, motionSync: true, angleSnap: false, ripple: false, sleepTimer: 30, lowPower: 10,
  dpi: { active: 1, stages: [{ x: 800, y: 800 }] }, currentDpi: { x: 800, y: 800 }, buttons: {},
};
void _shape;

describe('runWrites progress', () => {
  it('reports each write before it runs, in plan order', async () => {
    const dev = demoDevice();
    const base = await readSettings(dev);
    const draft = cloneSettings(base);
    draft.polling = 500;
    draft.debounce = 6;
    const seen: string[] = [];
    await runWrites(dev, planWrites(base, draft), (i, op) => seen.push(`${i}:${op.key}`));
    expect(seen).toEqual(['0:debounce', '1:polling']);
  });
});
