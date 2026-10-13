import { cls, html, type Html } from '../dom/html';
import { pendingChanges, type AppState } from '../state';
import { logo } from './logo';

/** The connection log, filled by the controller as each step really completes. */
export function bootScreen(s: AppState): Html {
  return html`<main class="scr center" data-key="scr-boot">
    <div class="term-box">
      <div class="check-h"><span>X3://CONNECT</span><span class="spin" aria-hidden="true"></span></div>
      <div class="boot" aria-live="polite">
        ${s.boot.map((b) => html`<div class="bl"><span>&gt; ${b.label}</span><span class="ld" aria-hidden="true"></span>${b.status === 'run'
          ? html`<span class="spin" aria-label="working"></span>`
          : html`<span class="${cls('ok', b.status === 'err' ? 'err' : b.value !== 'OK' && 'acc')}">${b.value}</span>`}</div>`)}
        <div><span class="cursor" aria-hidden="true"></span></div>
      </div>
    </div>
  </main>`;
}

export function asleepScreen(s: AppState): Html {
  const n = pendingChanges(s).length;
  return html`<main class="scr" data-key="scr-asleep">
    <span class="zz" aria-hidden="true">Z</span><span class="zz z2" aria-hidden="true">z</span><span class="zz z3" aria-hidden="true">z</span>
    ${logo('X3', { dim: true })}
    <h1 class="tagline">The mouse is asleep.</h1>
    <div class="check">
      <div class="check-h"><span class="spin" aria-hidden="true"></span><span>Retry #${s.sleepTry} · every 2 s</span></div>
      <ol>
        <li><b>01</b><span>Move the mouse to wake it<small>The dongle is connected, but the mouse is not answering. This page keeps retrying.</small></span></li>
        <li><b>02</b><span>${n ? `${n} staged ${n === 1 ? 'change is' : 'changes are'} kept` : 'Nothing is lost'}<small>${n ? 'Apply them once the mouse is awake.' : 'Sleep timer and Low Power Mode are adjustable once it is awake.'}</small></span></li>
      </ol>
    </div>
  </main>`;
}

export function noHidScreen(): Html {
  return html`<main class="scr" data-key="scr-nohid">
    ${logo('ERR', { label: 'Error' })}
    <h1 class="tagline">WebHID is not available in this browser.</h1>
    <div class="check">
      <div class="check-h"><span>[!]</span><span>What to do</span></div>
      <ol>
        <li><b>01</b><span>Open this page in Chrome, Edge or Opera<small>Firefox and Safari do not implement WebHID.</small></span></li>
        <li><b>02</b><span>Use HTTPS or localhost<small>Browsers only expose WebHID on secure origins.</small></span></li>
        <li><b>03</b><span>Or try the demo<small><a href="?demo">Open the demo</a>: it runs on frames captured from a real X3.</small></span></li>
      </ol>
    </div>
  </main>`;
}
