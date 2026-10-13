import { DEBOUNCE_MAX, DEBOUNCE_MIN, LOD_VALUES_MM, POLL_HZ_TO_VAL } from '../../protocol/device';
import { abar, seg, subhead, toggle } from '../components';
import type { AppActions } from '../context';
import { cls, html, type Html } from '../dom/html';
import type { LiveView, Section } from './types';

const RATES = Object.keys(POLL_HZ_TO_VAL).map(Number).sort((a, b) => a - b);

const FLAGS = [
  { field: 'motionSync', label: 'Motion sync', help: 'Aligns sensor reads with the polling clock.' },
  { field: 'angleSnap', label: 'Angle snapping', help: 'Straightens near-horizontal and near-vertical movement.' },
  { field: 'ripple', label: 'Ripple control', help: 'Smooths jitter at very high DPI.' },
] as const;

type Flag = (typeof FLAGS)[number]['field'];

const hzLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}K` : String(hz));
const intervalLabel = (hz: number) => `${+(1000 / hz).toFixed(3)} ms`;

/** Side view of the sensor over the pad, the gap drawn to scale. */
function lodArt(mm: number): { body: string; gap: string } {
  const rows = mm < 0.9 ? 1 : mm < 1.5 ? 2 : 4;
  return { body: ' ▄▆██████▆▄ ', gap: `${'     ┊      \n'.repeat(rows)}${'▀'.repeat(12)}` };
}

function polling(v: LiveView): Html {
  const capped = RATES.some((hz) => hz > v.info.maxHz);
  return html`<div class="block">
    ${subhead('Polling rate', { mod: v.changed.has('polling'), right: 'report interval' })}
    ${seg({
      action: 'perf.polling', label: 'Polling rate',
      options: RATES.map((hz) => ({
        label: hzLabel(hz), sub: intervalLabel(hz), value: hz, on: v.d.polling === hz,
        disabled: hz > v.info.maxHz, title: hz > v.info.maxHz ? 'Needs the 8K dongle or a cable' : `${hz} Hz`,
      })),
    })}
    <p class="hint tight">${capped ? 'Rates above 1000 Hz need the 8K dongle or a cable. ' : ''}Polling is written last: on the dongle it renegotiates the radio link.</p>
  </div>`;
}

function lod(v: LiveView): Html {
  return html`<div class="block">
    ${subhead('Lift-off distance', { mod: v.changed.has('lod'), right: 'sensor → surface' })}
    <div class="lods" role="group" aria-label="Lift-off distance">${LOD_VALUES_MM.map((mm) => {
      const on = v.d.lod === mm;
      const art = lodArt(mm);
      return html`<button class="${cls('lod', on && 'on')}" data-click="perf.lod" data-value="${mm}" aria-pressed="${String(on)}">
        <pre class="ascii" aria-hidden="true"><span class="lod-body">${art.body}</span><span class="lod-gap">${art.gap}</span></pre>
        <b>${mm.toFixed(1)} mm</b>
      </button>`;
    })}</div>
  </div>`;
}

function debounce(v: LiveView): Html {
  const pct = ((v.d.debounce - DEBOUNCE_MIN) / (DEBOUNCE_MAX - DEBOUNCE_MIN)) * 100;
  return html`<div class="block">
    ${subhead('Debounce', { mod: v.changed.has('debounce'), right: `${DEBOUNCE_MIN}–${DEBOUNCE_MAX} ms` })}
    <div class="row2">
      <span class="big-val">${v.d.debounce} ms</span>
      <div class="slider">
        ${abar({ pct, hot: true, input: { min: DEBOUNCE_MIN, max: DEBOUNCE_MAX, value: v.d.debounce, action: 'perf.debounce', label: 'Debounce in milliseconds', valueText: `${v.d.debounce} ms` } })}
        <div class="ticks" aria-hidden="true"><span>0</span><span>5</span><span>10</span><span>15</span><span>20</span></div>
      </div>
    </div>
  </div>`;
}

function flags(v: LiveView): Html {
  return html`<div class="block">
    ${subhead('Sensor flags')}
    <div class="toggles">${FLAGS.map((f) => toggle({
      action: 'perf.flag', field: f.field, label: f.label, help: f.help, on: v.d[f.field], mod: v.changed.has(f.field),
    }))}</div>
  </div>`;
}

const actions: AppActions = {
  'perf.polling': (ctx, e) => ctx.stage((d) => { d.polling = Number(e.value); }),
  'perf.lod': (ctx, e) => ctx.stage((d) => { d.lod = Number(e.value); }),
  'perf.debounce': (ctx, e) => ctx.stage((d) => { d.debounce = Number(e.value); }),
  'perf.flag': (ctx, e) => {
    const field = e.el.dataset.field as Flag;
    const on = (e.el as HTMLInputElement).checked;
    ctx.stage((d) => { d[field] = on; });
  },
};

export const performanceSection: Section = {
  id: 'perf',
  title: 'Performance',
  meta: () => 'sensor · radio',
  owns: (k) => ['polling', 'lod', 'debounce', 'motionSync', 'angleSnap', 'ripple'].includes(k),
  render: (v) => html`${polling(v)}${lod(v)}${debounce(v)}${flags(v)}`,
  actions,
};
