import type { AppActions } from '../context';
import { html, type Html } from '../dom/html';
import type { AppState } from '../state';
import { logo } from './logo';

export function connectScreen(s: AppState): Html {
  return html`<main class="scr" data-key="scr-connect">
    <div class="scan" aria-hidden="true"></div>
    ${logo('X3')}
    <h1 class="tagline">Configure your X3 from the browser<span class="cursor" aria-hidden="true"></span></h1>
    ${s.error ? html`<div class="err-box" role="alert"><div class="check-h"><span>[!!]</span><span>Could not connect</span></div><pre>${s.error}</pre></div>` : ''}
    <div class="cgrid">
      <div class="check">
        <div class="check-h"><span>[?]</span><span>Before you connect</span></div>
        <ol>
          <li><b>01</b><span>Plug in the X3 or its dongle<small>Move the mouse so it is awake; it sleeps after 30 s by default.</small></span></li>
          <li><b>02</b><span>Close Pulsar Fusion<small>It re-applies its own saved settings when it starts, and it holds the dongle open.</small></span></li>
          <li><b>03</b><span>Keep this page open in one tab only</span></li>
        </ol>
      </div>
      <div class="cta">
        <span class="tag ink">[✓] WebHID detected</span>
        <button class="bb big acc" data-click="connect.pick">▶ Connect mouse</button>
        <p class="hint tight">Pick <b>1K Dongle</b> (or the X3 itself when wired) in the browser's device chooser. The grant is remembered for this site.</p>
        <button class="bb ghost" data-click="connect.demo">Run demo · captured frames, no hardware</button>
      </div>
    </div>
  </main>`;
}

export const connectActions: AppActions = {
  'connect.pick': (ctx) => { void ctx.device.pick(); },
  'connect.demo': (ctx) => { void ctx.device.openDemo(); },
};
