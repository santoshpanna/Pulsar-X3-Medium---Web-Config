import { abar, seg, subhead } from '../components';
import type { AppActions } from '../context';
import { cls, html, type Html } from '../dom/html';
import { SLEEP_CHOICES } from '../settings';
import type { LiveView, Section } from './types';

function battery(v: LiveView): Html {
  const pct = v.info.battery;
  const low = pct !== null && pct <= v.d.lowPower;
  const status = pct === null ? 'unknown' : v.info.charging ? 'charging' : 'not charging';
  return html`<div class="block">
    ${subhead('Battery', { right: status })}
    <div class="bat-wrap">
      <div class="${cls('bat', low && 'low', v.info.charging && 'charging')}">${abar({ pct: pct ?? 0 })}</div>
      <div class="nub" aria-hidden="true"></div>
      <span class="bat-pc">${pct === null ? '—' : `${pct}%`}</span>
    </div>
    <div class="thr" aria-hidden="true"><span style="left:${v.d.lowPower}%">Low power ${v.d.lowPower}%</span></div>
  </div>`;
}

function lowPower(v: LiveView): Html {
  return html`<div class="block">
    ${subhead('Low power mode below', { mod: v.changed.has('lowPower'), right: '0–100%' })}
    <div class="row2">
      <span class="big-val">${v.d.lowPower}%</span>
      <div class="slider">
        ${abar({ pct: v.d.lowPower, hot: true, input: { min: 0, max: 100, value: v.d.lowPower, action: 'pwr.low', label: 'Low power mode threshold in percent', valueText: `${v.d.lowPower}%` } })}
        <div class="ticks" aria-hidden="true"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
      </div>
    </div>
  </div>`;
}

function sleep(v: LiveView): Html {
  const choices = SLEEP_CHOICES.some(([s]) => s === v.d.sleepTimer)
    ? SLEEP_CHOICES
    : [...SLEEP_CHOICES, [v.d.sleepTimer, `${v.d.sleepTimer} s`] as [number, string]].sort((a, b) => a[0] - b[0]);
  return html`<div class="block">
    ${subhead('Sleep after idle', { mod: v.changed.has('sleepTimer') })}
    ${seg({ action: 'pwr.sleep', label: 'Sleep after idle', small: true, options: choices.map(([sec, label]) => ({ label, value: sec, on: v.d.sleepTimer === sec })) })}
  </div>`;
}

const actions: AppActions = {
  'pwr.low': (ctx, e) => ctx.stage((d) => { d.lowPower = Number(e.value); }),
  'pwr.sleep': (ctx, e) => ctx.stage((d) => { d.sleepTimer = Number(e.value); }),
};

export const powerSection: Section = {
  id: 'pwr',
  title: 'Power',
  meta: () => 'battery · sleep',
  owns: (k) => k === 'sleepTimer' || k === 'lowPower',
  render: (v) => html`${battery(v)}${lowPower(v)}${sleep(v)}`,
  actions,
};
