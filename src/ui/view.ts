import { RULE_RUN } from './ascii/glyphs';
import { dock } from './chrome/dock';
import { footer } from './chrome/footer';
import { header } from './chrome/header';
import { hero } from './chrome/hero';
import { rail, stagedIn } from './chrome/rail';
import { toast } from './chrome/toast';
import { cls, html, pad2, type Html } from './dom/html';
import { connectScreen } from './screens/connect';
import { asleepScreen, bootScreen, noHidScreen } from './screens/status';
import { SECTIONS, type LiveView, type Section } from './sections';
import { pendingChanges, type AppState } from './state';

/** The render context for the editor, or null when there is nothing to edit yet. */
export function liveView(s: AppState): LiveView | null {
  if (s.phase !== 'live' || !s.settings || !s.draft || !s.info) return null;
  const changes = pendingChanges(s);
  return {
    s, d: s.draft, m: s.settings, info: s.info, changes,
    changed: new Set(changes.map((c) => c.key)),
    busy: s.busy,
  };
}

function sectionFrame(sec: Section, i: number, v: LiveView): Html {
  const n = stagedIn(sec, v);
  return html`<section class="sec" id="sec-${sec.id}" style="--i:${i}" aria-labelledby="sec-${sec.id}-t">
    <header class="sec-h">
      <span class="sec-no">[${pad2(i + 1)}]</span><h2 class="sec-t" id="sec-${sec.id}-t">${sec.title}</h2>
      <span class="fill ascii" aria-hidden="true">${RULE_RUN}</span>
      ${n ? html`<span class="dirty">*${n} staged</span>` : ''}
      ${sec.meta ? html`<span class="sec-meta">${sec.meta(v)}</span>` : ''}
    </header>
    <div class="sec-b">${sec.render(v)}</div>
  </section>`;
}

function editor(v: LiveView): Html {
  return html`<main class="live" data-key="scr-live">
    ${hero(v)}
    <div class="body">
      ${rail(SECTIONS, v)}
      <div class="${cls('main', v.busy && 'is-busy')}">${SECTIONS.map((sec, i) => sectionFrame(sec, i, v))}</div>
    </div>
  </main>`;
}

function screen(s: AppState): Html {
  if (!s.hidSupported && !s.demo) return noHidScreen();
  const v = liveView(s);
  if (v) return editor(v);
  if (s.phase === 'asleep') return asleepScreen(s);
  if (s.phase === 'connecting') return bootScreen(s);
  return connectScreen(s);
}

/** The whole page, as one string, for `morph` to apply. */
export function renderApp(s: AppState): Html {
  const v = liveView(s);
  return html`${toast(s.toast)}${header(s)}${screen(s)}${footer()}${v ? dock(v) : ''}`;
}
