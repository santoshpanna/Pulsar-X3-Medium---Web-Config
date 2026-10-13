import { hex } from '../../protocol/packet';
import type { TraceEntry } from '../../protocol/transport';
import { abar, subhead } from '../components';
import type { AppActions } from '../context';
import { cls, html, type Html } from '../dom/html';
import type { LiveView, Section } from './types';

/** Show only the tail: the terminal box scrolls, and the full log is one Copy away. */
const SHOWN = 120;

export function traceText(trace: readonly TraceEntry[]): string {
  return trace
    .map((t) => `${(t.t / 1000).toFixed(3).padStart(9)} ${t.dir.toUpperCase()} ${hex(t.bytes, 24)}${t.note ? `  <${t.note}>` : ''}`)
    .join('\n');
}

function terminal(v: LiveView): Html {
  const trace = v.s.trace.slice(-SHOWN);
  return html`<div class="term" role="log" aria-label="HID trace" data-stick-bottom>
    ${trace.length ? trace.map((t) => html`<div class="${cls('tl', t.note && 'flag')}">
      <span class="t">${(t.t / 1000).toFixed(3).padStart(9)}</span><span class="${cls('d', t.dir === 'tx' && 'out')}">${t.dir.toUpperCase()}</span><span>${hex(t.bytes, 24)}</span>${t.note ? html`<span class="n">&lt;${t.note}&gt;</span>` : ''}
    </div>`) : html`<div class="tl"><span class="t">(no traffic yet)</span></div>`}
    <div class="tl"><span class="cursor" aria-hidden="true"></span></div>
  </div>`;
}

function reset(v: LiveView): Html {
  const hold = v.s.ui.hold?.name === 'diag.reset' ? v.s.ui.hold.pct : 0;
  return html`<div class="danger">
    ${subhead('Factory reset', { right: 'unverified on X3' })}
    <p class="hint">Sends the reset sequence captured from Pulsar Fusion on an X2A. On that mouse it wipes profile 1 and all global settings. Writes immediately, bypassing the draft.</p>
    <button class="hold" data-hold="diag.reset" data-hold-ms="1500" aria-label="Press and hold to factory reset"${v.busy ? html` disabled` : ''}>
      ${abar({ pct: hold })}
      <span class="lbl">${hold ? `Keep holding · ${Math.round(hold)}%` : 'Hold to factory reset'}</span>
    </button>
  </div>`;
}

const actions: AppActions = {
  'diag.toggle': (ctx) => ctx.ui({ traceOpen: !ctx.get().ui.traceOpen }),
  'diag.clear': (ctx) => ctx.store.set({ trace: [] }),
  'diag.copy': (ctx) => {
    const { trace } = ctx.get();
    navigator.clipboard.writeText(traceText(trace)).then(
      () => ctx.toast(`Copied ${trace.length} frames`, 'info'),
      () => ctx.toast('The browser blocked clipboard access', 'err'),
    );
  },
  'diag.reset': (ctx) => ctx.device.factoryReset(),
};

export const diagnosticsSection: Section = {
  id: 'diag',
  title: 'Diagnostics',
  meta: () => 'hid trace · 64-byte feature reports',
  render: (v) => html`
    <div class="diag-bar">
      <button class="bb ghost" data-click="diag.toggle" aria-expanded="${String(v.s.ui.traceOpen)}">${v.s.ui.traceOpen ? 'Hide trace' : 'Show trace'}</button>
      <button class="bb ghost" data-click="diag.copy">Copy</button>
      <button class="bb ghost" data-click="diag.clear">Clear</button>
      <span class="mute small push">${v.s.trace.length} frames</span>
    </div>
    ${v.s.ui.traceOpen ? terminal(v) : html`<p class="hint">Every 64-byte feature report sent and received, for protocol work and bug reports.</p>`}
    ${reset(v)}`,
  actions,
};
