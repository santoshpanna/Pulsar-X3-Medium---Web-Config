import { abar } from '../components';
import type { AppActions } from '../context';
import { flag, html, type Html } from '../dom/html';
import type { Change } from '../settings';
import type { LiveView } from '../sections/types';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m === 1 ? '1 min ago' : `${m} min ago`;
}

const diffList = (cs: Change[]) => html`<div class="diff">${cs.map((c) => html`
  <div class="dl"><span class="sg" aria-hidden="true">~</span><span class="lb">${c.label}</span>
    <span class="vv"><s>${c.before}</s><span aria-hidden="true">──►</span><span class="to">${c.after}</span></span></div>`)}
</div>`;

/** The sticky bottom bar: staged edits, a write in progress, or the last apply with Revert. */
export function dock(v: LiveView): Html {
  const { s, changes } = v;
  const p = s.progress;
  if (p) {
    return html`<section class="dock" data-key="dock-progress" aria-live="polite">
      <div class="prog">
        <span class="spin" aria-hidden="true"></span>
        <b>${p.verb} ${Math.min(p.done + 1, p.total)}/${p.total}</b>
        ${abar({ pct: (p.done / p.total) * 100 })}
        <span>${p.label}</span>
      </div>
    </section>`;
  }
  if (changes.length) {
    return html`<section class="dock" data-key="dock-pending" aria-live="polite" aria-label="Staged changes">
      <div class="dock-h">
        <div class="ttl"><span class="cnt">${changes.length}</span>
          <span>${changes.length === 1 ? 'Unapplied change' : 'Unapplied changes'}<br><span class="mute small">Nothing is written to the mouse until you apply</span></span></div>
        <div class="dock-act">
          <button class="bb ghost" data-click="dock.diff" aria-expanded="${String(s.ui.diffOpen)}">${s.ui.diffOpen ? 'Hide diff' : 'Show diff'}</button>
          <button class="bb" data-click="dock.discard"${flag('disabled', s.busy)}>Discard</button>
          <button class="bb acc" data-click="dock.apply"${flag('disabled', s.busy)}>Apply to mouse ⏎</button>
          <span class="kbd" title="Keyboard shortcut">Ctrl+S</span>
        </div>
      </div>
      ${s.ui.diffOpen ? diffList(changes) : ''}
    </section>`;
  }
  if (s.applied) {
    return html`<section class="dock" data-key="dock-applied" aria-live="polite">
      <div class="dock-h">
        <div class="ttl"><span class="tag acc big-tag">[✓]</span>
          <span>Applied ${plural(s.applied.changes.length, 'change')} · <span class="mute">${timeAgo(s.applied.at)}</span><br><span class="mute small">Read back from the mouse after writing</span></span></div>
        <div class="dock-act">
          <button class="bb" data-click="dock.revert" title="Put back the values the mouse had before this apply"${flag('disabled', s.busy)}>↶ Revert</button>
          <button class="bb ghost" data-click="dock.dismiss">Dismiss</button>
        </div>
      </div>
    </section>`;
  }
  return html``;
}

export const dockActions: AppActions = {
  'dock.apply': (ctx) => ctx.device.apply(),
  'dock.discard': (ctx) => ctx.device.discard(),
  'dock.revert': (ctx) => ctx.device.revert(),
  'dock.dismiss': (ctx) => ctx.store.set({ applied: null }),
  'dock.diff': (ctx) => ctx.ui({ diffOpen: !ctx.get().ui.diffOpen }),
};
