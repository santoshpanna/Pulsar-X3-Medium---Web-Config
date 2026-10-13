import { html, type Html } from '../dom/html';
import type { Toast } from '../state';

const TAG = { ok: '[OK]', err: '[!!]', info: '[i]' } as const;

/** Keyed by id so each new message is a fresh node and its slide-in replays. */
export function toast(t: Toast | null): Html {
  if (!t) return html``;
  return html`<div class="toast ${t.kind}" data-key="toast-${t.id}" role="${t.kind === 'err' ? 'alert' : 'status'}">
    <div class="toast-h"><span>${TAG[t.kind]}</span><span>X3://LOG</span></div>
    <div class="toast-b">${t.msg}</div>
    <div class="toast-t" style="animation-duration:${t.ms}ms"></div>
  </div>`;
}
