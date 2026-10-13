import { figletSvg } from '../ascii/figlet-svg';
import { cls, html, raw, type Html } from '../dom/html';
import type { LiveView } from '../sections/types';

const onOff = (b: boolean) => (b ? 'on' : 'off');

/** The big readout: the active stage in block digits, plus the headline settings. */
export function hero(v: LiveView): Html {
  const { d, m, s } = v;
  const active = d.dpi.stages[d.dpi.active - 1]?.x ?? 0;
  const onMouse = m.dpi.stages[m.dpi.active - 1]?.x;
  const digits = s.ui.scramble ?? String(active);
  const hz = d.polling;
  return html`<section class="hero">
    <div class="hero-l">
      <div class="eyebrow">
        <span>Active DPI</span><span class="mute">//</span><span>stage ${d.dpi.active} of ${d.dpi.stages.length}</span>
        ${active !== onMouse ? html`<span class="tag acc">staged</span>` : ''}
        ${m.currentDpi.x !== onMouse ? html`<span class="tag">sensor now ${m.currentDpi.x}</span>` : ''}
      </div>
      <div class="${cls('fig', s.ui.scramble && 'glitch')}" role="img" aria-label="${active} DPI">${raw(figletSvg(digits))}</div>
    </div>
    <div class="hero-r">
      <div class="stat"><div class="k">Polling</div><div class="v">${hz ?? '?'}<small>Hz</small></div>
        <div class="ticker ascii" aria-hidden="true"><span style="animation-duration:${hz ? 500 / hz : 4}s">${'▌ '.repeat(120)}</span></div></div>
      <div class="stat"><div class="k">Lift-off</div><div class="v">${d.lod.toFixed(1)}<small>mm</small></div></div>
      <div class="stat"><div class="k">Debounce</div><div class="v">${d.debounce}<small>ms</small></div></div>
      <div class="stat"><div class="k">Sensor flags</div><div class="v flags">sync ${onOff(d.motionSync)} · snap ${onOff(d.angleSnap)} · ripple ${onOff(d.ripple)}</div></div>
    </div>
  </section>`;
}
