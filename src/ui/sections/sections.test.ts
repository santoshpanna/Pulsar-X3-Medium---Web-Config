import { describe, expect, it } from 'vitest';
import { keyboardBinding } from '../../protocol/buttons';
import { DemoTransport } from '../../protocol/captured';
import { PulsarX3 } from '../../protocol/device';
import { Session } from '../../protocol/transport';
import { dockActions } from '../chrome/dock';
import { headerActions } from '../chrome/header';
import { connectActions } from '../screens/connect';
import { cloneSettings, diffSettings, readSettings, type Settings } from '../settings';
import { initialState, type AppState } from '../state';
import { renderApp } from '../view';
import { SECTIONS, sectionOf } from '.';

async function liveState(edit?: (d: Settings) => void): Promise<AppState> {
  const settings = await readSettings(new PulsarX3(new Session(new DemoTransport(), { pollMs: 1 })));
  const draft = cloneSettings(settings);
  edit?.(draft);
  const s = initialState(true, 'auto');
  return {
    ...s,
    phase: 'live',
    settings,
    draft,
    info: {
      productName: 'Pulsar 1K wireless dongle', productId: 0x5402, mouseName: 'Pulsar X3', firmware: '1.0.16',
      battery: 51, charging: false, wireless: true, maxHz: 1000,
    },
    signal: [95, 97],
    ui: { ...s.ui, traceOpen: true, capturing: 0x01 },
  };
}

/** Every change a user can stage, so ownership is checked for all keys. */
function editEverything(d: Settings) {
  d.dpi.stages.push({ x: 1600, y: 1600 });
  d.polling = 500;
  d.lod = 2;
  d.debounce = 5;
  d.motionSync = !d.motionSync;
  d.angleSnap = !d.angleSnap;
  d.ripple = !d.ripple;
  d.sleepTimer = 300;
  d.lowPower = 20;
  for (const id of Object.keys(d.buttons)) d.buttons[Number(id)] = keyboardBinding(0, 0x04);
}

describe('section registry', () => {
  it('has unique ids', () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns every staged change to exactly one section', async () => {
    const s = await liveState(editEverything);
    const changes = diffSettings(s.settings!, s.draft!);
    expect(changes.length).toBeGreaterThan(10);
    for (const c of changes) {
      const owners = SECTIONS.filter((sec) => sec.owns?.(c.key));
      expect(owners.map((o) => o.id), c.key).toHaveLength(1);
      expect(sectionOf(c.key)).toBe(owners[0]);
    }
  });

  it('registers a handler for every action named in the markup', async () => {
    const all = { ...headerActions, ...dockActions, ...connectActions, ...Object.assign({}, ...SECTIONS.map((s) => s.actions ?? {})) };
    const live = await liveState(editEverything);
    const pages = [
      renderApp(live).value,
      renderApp({ ...live, applied: { before: live.settings!, changes: [], at: Date.now() }, draft: live.settings }).value,
      renderApp(initialState(true, 'auto')).value,
    ];
    const named = new Set<string>();
    for (const page of pages) {
      for (const m of page.matchAll(/data-(?:click|input|change|keydown|focusout|hold|drop)="([^"]+)"/g)) named.add(m[1]);
    }
    expect(named.size).toBeGreaterThan(20);
    for (const name of named) expect(all, name).toHaveProperty([name]);
  });

  it('marks staged sections in the page', async () => {
    const page = renderApp(await liveState((d) => { d.polling = 500; })).value;
    expect(page).toContain('*1 staged');
    expect(page).toContain('Unapplied change');
  });
});
