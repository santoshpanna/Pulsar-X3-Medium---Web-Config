import { meter, sparkline } from '../ascii/glyphs';
import type { AppActions } from '../context';
import { flag, html, type Html } from '../dom/html';
import type { AppState, Theme } from '../state';

const THEMES: Theme[] = ['auto', 'light', 'dark'];
const THEME_GLYPH: Record<Theme, string> = { auto: '◐', light: '○', dark: '●' };

function status(s: AppState): Html {
  const info = s.info!;
  const sig = s.signal.length ? s.signal[s.signal.length - 1] : null;
  return html`<div class="status" aria-label="Device status">
    <span><span class="dot" aria-hidden="true"></span><b>${info.mouseName}</b> <span class="mute">${info.productName}</span></span>
    <span><span class="k">FW</span><b>${info.firmware}</b></span>
    <span><span class="k">BAT</span>${info.battery === null
      ? html`<b class="mute">unknown</b>`
      : html`<b class="ascii">${meter(info.battery)}</b> <b>${info.battery}%</b>`}${info.charging ? html` <span class="tag">charging</span>` : ''}</span>
    ${info.wireless ? html`<span><span class="k">SIG</span>${sig === null
      ? html`<b class="mute">—</b>`
      : html`<b class="ascii spark">${sparkline(s.signal, 70, 100)}</b> <b>${sig}%</b>`}</span>` : ''}
  </div>`;
}

export function header(s: AppState): Html {
  const live = s.phase === 'live' && s.info;
  return html`<header class="top">
    <div class="brand"><span>PULSAR/X3</span><span class="sl" aria-hidden="true">▚</span><span class="wc">WEB.CONFIG</span>${s.demo ? html`<span class="tag acc">demo</span>` : ''}</div>
    ${live ? status(s) : html`<div class="status"><span class="mute">Local only · nothing leaves your machine</span></div>`}
    <div class="top-act">
      <button class="bb ghost sq" data-click="app.theme" title="Theme: ${s.ui.theme}" aria-label="Theme: ${s.ui.theme}. Click to change.">${THEME_GLYPH[s.ui.theme]}</button>
      ${live ? html`
        <button class="bb ghost" data-click="app.refresh" title="Re-read every setting from the mouse; staged edits are kept"${flag('disabled', s.busy)}>↻ Re-read</button>
        <button class="bb ghost" data-click="app.disconnect">Disconnect</button>` : ''}
    </div>
  </header>`;
}

export const headerActions: AppActions = {
  'app.theme': (ctx) => {
    const cur = ctx.get().ui.theme;
    ctx.ui({ theme: THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length] });
  },
  'app.refresh': (ctx) => ctx.device.refresh(),
  'app.disconnect': (ctx) => { void ctx.device.disconnect(); },
};
