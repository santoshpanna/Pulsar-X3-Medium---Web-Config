import { BINDING_OPTIONS, BtnType, X3_BUTTONS, describeBinding, findOptionId } from '../../protocol/buttons';
import { chip, keycaps } from '../components';
import type { AppActions } from '../context';
import { cls, html, type Html } from '../dom/html';
import { captureKey } from '../keycapture';
import type { LiveView, Section } from './types';

const r = (c: string, n: number) => c.repeat(n);

/** Top view of the X3, in character cells. Marker cells are left blank. */
const ART = [
  `    ╭${r('─', 6)}┬${r('─', 4)}┬${r('─', 6)}╮`,
  `    │${r(' ', 6)}│${r('░', 4)}│${r(' ', 6)}│`,
  `    │${r(' ', 6)}│${r(' ', 4)}│${r(' ', 6)}│`,
  `    │${r(' ', 6)}│${r('░', 4)}│${r(' ', 6)}│`,
  `    │${r(' ', 6)}╰${r('─', 4)}╯${r(' ', 6)}│`,
  `    │${r(' ', 18)}│`,
  `    ├${r('─', 18)}┤`,
  ` ┌──┤${r(' ', 18)}│`,
  ` │  │${r(' ', 18)}│`,
  ` ├──┤${r(' ', 18)}│`,
  ` │  │${r(' ', 18)}│`,
  ` └──┤${r(' ', 18)}│`,
  `    │${r(' ', 18)}│`,
  '    │   P U L S A R    │',
  '    │        X3        │',
  `    │${r(' ', 18)}│`,
  `    ╰${r('─', 18)}╯`,
  '        underside ──►    ',
].join('\n');

/** Where each button's two-cell marker sits on ART: row, column. */
const MARKERS: Record<number, [number, number]> = {
  0x01: [2, 7],
  0x02: [2, 19],
  0x03: [2, 13],
  0x04: [8, 2],
  0x05: [10, 2],
  0x0b: [17, 21],
};

const GROUPS = [...new Set(BINDING_OPTIONS.map((o) => o.group))];

const label = (id: number) => X3_BUTTONS.find((b) => b.id === id)?.label ?? `Button ${id}`;
const num = (i: number) => String(i + 1).padStart(2, '0');

function art(v: LiveView): Html {
  const sel = v.s.ui.button;
  return html`<div>
    <div class="art">
      <pre class="ascii" aria-hidden="true">${ART}</pre>
      ${X3_BUTTONS.map((b, i) => {
        const [row, col] = MARKERS[b.id] ?? [0, 0];
        return html`<button class="${cls('mk', b.id === sel && 'on', v.changed.has(`button:${b.id}`) && 'mod')}" style="top:calc(${row} * var(--art-lh));left:${col}ch"
          data-click="btn.select" data-value="${b.id}" aria-label="Edit ${b.label}">${num(i)}</button>`;
      })}
    </div>
    <p class="art-cap">Top view · click a number or a row</p>
  </div>`;
}

function list(v: LiveView): Html {
  const sel = v.s.ui.button;
  return html`<div class="blist" role="group" aria-label="Buttons">${X3_BUTTONS.map((b, i) => {
    const on = b.id === sel;
    return html`<button class="${cls('br', on && 'on')}" data-click="btn.select" data-value="${b.id}" aria-pressed="${String(on)}">
      <span class="no">${num(i)}</span><span class="lb">${b.label}</span><span class="ld" aria-hidden="true"></span>
      <span class="v">${describeBinding(v.d.buttons[b.id])}</span>${v.changed.has(`button:${b.id}`) ? html`<span class="star" title="Staged">*</span>` : ''}
    </button>`;
  })}</div>`;
}

function picker(v: LiveView): Html {
  const id = v.s.ui.button;
  const cur = v.d.buttons[id];
  const capturing = v.s.ui.capturing === id;
  const selected = findOptionId(cur);
  const isKbd = cur?.type === BtnType.Keyboard;
  const idx = X3_BUTTONS.findIndex((b) => b.id === id);
  return html`<div class="picker">
    <div class="pk-h"><span>${num(idx)} // ${label(id)}</span><span class="cur">→ ${cur ? describeBinding(cur) : '—'}</span></div>
    <div class="pk-b">
      ${selected === '' && cur ? html`<p class="hint tight">Unknown binding (${describeBinding(cur)}). Pick a replacement below.</p>` : ''}
      ${GROUPS.map((g) => html`<div class="pk-g"><span class="pk-gl">${g}</span><div class="chips">${BINDING_OPTIONS.filter((o) => o.group === g).map((o) => chip({
        label: o.label, value: o.id, action: 'btn.bind', on: selected === o.id,
      }))}</div></div>`)}
      <div class="pk-g"><span class="pk-gl">Keyboard</span>
        <div class="keys">
          <button class="${cls('rec', capturing && 'on', isKbd && 'set')}" data-click="btn.record"><span class="r" aria-hidden="true"></span>${capturing ? 'Recording…' : 'Record key combo'}</button>
          ${isKbd && !capturing ? keycaps(describeBinding(cur)) : ''}
        </div>
        ${capturing ? html`<input class="cap" readonly data-autofocus data-keydown="btn.capture" data-focusout="btn.stopRecord"
          value="${v.s.ui.capturePreview}" placeholder="Press a key combination · Esc cancels" aria-label="Press a key combination for ${label(id)}" />` : ''}
      </div>
    </div>
  </div>`;
}

const actions: AppActions = {
  'btn.select': (ctx, e) => ctx.ui({ button: Number(e.value), capturing: null, capturePreview: '' }),
  'btn.bind': (ctx, e) => {
    const opt = BINDING_OPTIONS.find((o) => o.id === e.value);
    if (!opt) return;
    const id = ctx.get().ui.button;
    ctx.ui({ capturing: null });
    ctx.stage((d) => { d.buttons[id] = { ...opt.binding }; });
  },
  'btn.record': (ctx) => {
    const { ui } = ctx.get();
    ctx.ui({ capturing: ui.capturing === ui.button ? null : ui.button, capturePreview: '' });
  },
  'btn.stopRecord': (ctx) => ctx.ui({ capturing: null, capturePreview: '' }),
  'btn.capture': (ctx, e) => {
    const ev = e.event as KeyboardEvent;
    ev.preventDefault();
    const id = ctx.get().ui.capturing;
    if (id === null) return;
    const r = captureKey(ev);
    switch (r.kind) {
      case 'cancel': ctx.ui({ capturing: null, capturePreview: '' }); break;
      case 'modifier': ctx.ui({ capturePreview: r.preview }); break;
      case 'unsupported': ctx.toast(`Key ${r.code} is not in the HID table`, 'err'); break;
      case 'bound':
        ctx.ui({ capturing: null, capturePreview: '' });
        ctx.stage((d) => { d.buttons[id] = r.binding; });
        break;
    }
  },
};

export const buttonsSection: Section = {
  id: 'btn',
  title: 'Buttons',
  meta: () => `${X3_BUTTONS.length} physical`,
  owns: (k) => k.startsWith('button:'),
  render: (v) => html`
    <p class="hint">Pick a button on the drawing or in the list, then pick what it does, or record any key combination.</p>
    <div class="bgrid">${art(v)}${list(v)}${picker(v)}</div>`,
  actions,
};
