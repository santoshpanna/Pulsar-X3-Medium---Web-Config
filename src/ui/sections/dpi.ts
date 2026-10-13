import { DPI_MAX, DPI_MIN, DPI_STEP, MAX_DPI_STAGES } from '../../protocol/device';
import { SCALE_MAX, dpiPct, dpiToPos, posToDpi, snapDpi } from '../ascii/scale';
import { abar, chip } from '../components';
import type { AppActions, Ctx } from '../context';
import { cls, flag, html, pad2, type Html } from '../dom/html';
import type { ActionEvent } from '../dom/events';
import type { LiveView, Section } from './types';

const TICKS: [number, string][] = [[50, '50'], [200, '200'], [800, '800'], [3200, '3.2K'], [12800, '12.8K'], [32000, '32K']];
const PRESETS: { label: string; stages: number[]; active: number }[] = [
  { label: 'Low 400 / 800 / 1600', stages: [400, 800, 1600], active: 2 },
  { label: 'Mid 800 / 1600 / 3200', stages: [800, 1600, 3200], active: 2 },
  { label: 'High 1600 / 3200 / 6400', stages: [1600, 3200, 6400], active: 2 },
];

function stageRow(v: LiveView, dpi: number, i: number): Html {
  const n = i + 1;
  const active = v.d.dpi.active === n;
  const text = v.s.ui.dpiText[i];
  return html`<div class="${cls('stage', active && 'is-active')}">
    <button class="stage-no" data-click="dpi.active" data-value="${n}" aria-pressed="${String(active)}" aria-label="Make stage ${n} active">[${pad2(n)}]</button>
    ${abar({
      pct: dpiPct(dpi),
      input: { min: 0, max: SCALE_MAX, value: dpiToPos(dpi), action: 'dpi.slide', label: `Stage ${n} DPI`, valueText: `${dpi} DPI`, data: { index: i } },
    })}
    <input class="num" type="text" inputmode="numeric" autocomplete="off" value="${text ?? dpi}"
      data-input="dpi.type" data-change="dpi.commit" data-keydown="dpi.key" data-index="${i}" aria-label="Stage ${n} DPI value" />
    <span class="${active ? 'act' : 'act-off'}">${active ? '◄ Active' : ''}</span>
    <button class="x" data-click="dpi.remove" data-index="${i}" aria-label="Remove stage ${n}"${flag('disabled', v.d.dpi.stages.length <= 1)}>×</button>
  </div>`;
}

const index = (e: ActionEvent) => Number(e.el.dataset.index);

function activeDpi(ctx: Ctx): number | undefined {
  const d = ctx.get().draft;
  return d?.dpi.stages[d.dpi.active - 1]?.x;
}

function clearText(ctx: Ctx, i: number) {
  const dpiText = { ...ctx.get().ui.dpiText };
  delete dpiText[i];
  ctx.ui({ dpiText });
}

const actions: AppActions = {
  'dpi.active': (ctx, e) => {
    const n = Number(e.value);
    ctx.stage((d) => { d.dpi.active = n; });
    const dpi = activeDpi(ctx);
    if (dpi !== undefined) ctx.scramble(dpi);
  },
  'dpi.slide': (ctx, e) => {
    const i = index(e);
    const v = posToDpi(Number(e.value));
    ctx.stage((d) => { if (d.dpi.stages[i]) d.dpi.stages[i] = { x: v, y: v }; });
  },
  'dpi.type': (ctx, e) => ctx.ui({ dpiText: { ...ctx.get().ui.dpiText, [index(e)]: e.value } }),
  'dpi.commit': (ctx, e) => {
    const i = index(e);
    const typed = e.value.trim();
    clearText(ctx, i);
    const n = Number(typed.replace(/[^\d]/g, ''));
    if (!typed || !Number.isFinite(n)) return;
    const v = snapDpi(n);
    ctx.stage((d) => { if (d.dpi.stages[i]) d.dpi.stages[i] = { x: v, y: v }; });
    if (v !== n) ctx.toast(`Snapped to ${v}: ${DPI_MIN}–${DPI_MAX} DPI in steps of ${DPI_STEP}`, 'info');
  },
  'dpi.key': (ctx, e) => {
    const ev = e.event as KeyboardEvent;
    const input = e.el as HTMLInputElement;
    if (ev.key === 'Enter') input.blur();
    if (ev.key === 'Escape') {
      const i = index(e);
      input.value = String(ctx.get().draft?.dpi.stages[i]?.x ?? '');
      clearText(ctx, i);
      input.blur();
    }
  },
  'dpi.remove': (ctx, e) => {
    const i = index(e);
    ctx.stage((d) => {
      if (d.dpi.stages.length <= 1) return;
      d.dpi.stages.splice(i, 1);
      if (d.dpi.active > i + 1) d.dpi.active -= 1;
      d.dpi.active = Math.min(Math.max(1, d.dpi.active), d.dpi.stages.length);
    });
    const dpi = activeDpi(ctx);
    if (dpi !== undefined) ctx.scramble(dpi);
  },
  'dpi.add': (ctx) => ctx.stage((d) => {
    if (d.dpi.stages.length >= MAX_DPI_STAGES) return;
    const last = d.dpi.stages[d.dpi.stages.length - 1]?.x ?? 800;
    const next = Math.min(DPI_MAX, last * 2);
    d.dpi.stages.push({ x: next, y: next });
  }),
  'dpi.preset': (ctx, e) => {
    const p = PRESETS[Number(e.value)];
    if (!p) return;
    ctx.stage((d) => {
      d.dpi.stages = p.stages.map((x) => ({ x, y: x }));
      d.dpi.active = p.active;
    });
    ctx.scramble(p.stages[p.active - 1]);
  },
};

export const dpiSection: Section = {
  id: 'dpi',
  title: 'DPI stages',
  nav: 'DPI',
  meta: () => `${DPI_MIN}–${DPI_MAX} · step ${DPI_STEP} · log scale`,
  owns: (k) => k === 'dpi' || k === 'dpiActive',
  render(v) {
    const count = v.d.dpi.stages.length;
    return html`
      <p class="hint">Click a stage number to make it active. Drag a bar or type a value. The button on the bottom of the mouse cycles through the stages in order.</p>
      <div class="stages">${v.d.dpi.stages.map((st, i) => stageRow(v, st.x, i))}</div>
      <div class="scale" aria-hidden="true"><div class="scale-in">${TICKS.map(([dpi, label]) => html`<span style="left:${dpiPct(dpi).toFixed(2)}%">${label}</span>`)}</div></div>
      <div class="dpi-foot">
        <button class="add" data-click="dpi.add"${flag('disabled', count >= MAX_DPI_STAGES)}>+ Add stage</button>
        <span class="mute small">${count} / ${MAX_DPI_STAGES} stages</span>
        <span class="presets"><span class="mute small">Presets →</span>${PRESETS.map((p, i) => chip({
          label: p.label, value: String(i), action: 'dpi.preset',
          on: p.stages.length === count && p.stages.every((x, j) => v.d.dpi.stages[j].x === x),
        }))}</span>
      </div>`;
  },
  actions,
};
