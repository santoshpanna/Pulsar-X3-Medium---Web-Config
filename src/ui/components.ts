import { BLOCK_RUN, SHADE_RUN, clamp } from './ascii/glyphs';
import { cls, flag, html, raw, type Child, type Html } from './dom/html';

/** `data-*` attributes from a record: `{ index: 2 }` → ` data-index="2"`. */
export function dataAttrs(data: Record<string, string | number> = {}): Html {
  return html`${Object.entries(data).map(([k, v]) => html` data-${raw(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))}="${v}"`)}`;
}

export interface RangeInput {
  min: number;
  max: number;
  step?: number;
  value: number;
  /** Action run on every `input` event. */
  action: string;
  label: string;
  valueText?: string;
  data?: Record<string, string | number>;
}

/**
 * A character-cell bar: a run of ░ with a run of █ clipped to `pct`. With
 * `input`, a transparent native range input sits on top, so dragging, arrow
 * keys and screen readers all work as for any slider.
 */
export function abar(opts: { pct: number; hot?: boolean; cls?: string; input?: RangeInput }): Html {
  const { input } = opts;
  return html`<div class="${cls('abar', opts.hot && 'hot', opts.cls)}">
    <span class="abar-bg" aria-hidden="true">${SHADE_RUN}</span>
    <span class="abar-fill" style="width:${clamp(opts.pct, 0, 100).toFixed(2)}%" aria-hidden="true">${BLOCK_RUN}</span>
    ${input ? html`<input class="abar-in" type="range" min="${input.min}" max="${input.max}" step="${input.step ?? 1}" value="${input.value}"
      data-input="${input.action}"${dataAttrs(input.data)} aria-label="${input.label}"${input.valueText ? html` aria-valuetext="${input.valueText}"` : ''} />` : ''}
  </div>`;
}

export interface SegOption {
  label: string;
  sub?: string;
  value: string | number;
  on: boolean;
  disabled?: boolean;
  title?: string;
}

/** A row of mutually exclusive buttons. */
export function seg(opts: { action: string; label: string; options: SegOption[]; small?: boolean }): Html {
  return html`<div class="${cls('seg', opts.small && 'small')}" role="group" aria-label="${opts.label}">${opts.options.map((o) => html`
    <button class="${cls(o.on && 'on')}" data-click="${opts.action}" data-value="${o.value}" aria-pressed="${String(o.on)}"${flag('disabled', o.disabled)}${o.title ? html` title="${o.title}"` : ''}>
      <b>${o.label}</b>${o.sub ? html`<i>${o.sub}</i>` : ''}
    </button>`)}
  </div>`;
}

/** Staged-edit marker. */
export const mod = (on: boolean): Child => (on ? html`<span class="mod" title="Staged, not yet applied">*</span>` : '');

/** A dotted-leader heading inside a section. */
export function subhead(label: string, opts: { mod?: boolean; right?: Child } = {}): Html {
  return html`<div class="sub-h"><span>${label}</span><span class="ld" aria-hidden="true"></span>${mod(!!opts.mod)}${opts.right !== undefined ? html`<span class="mute">${opts.right}</span>` : ''}</div>`;
}

/** A checkbox drawn as `[■]` / `[ ]`. */
export function toggle(opts: { action: string; field: string; label: string; help: string; on: boolean; mod: boolean }): Html {
  return html`<label class="${cls('tg', opts.on && 'on')}">
    <input type="checkbox" data-change="${opts.action}" data-field="${opts.field}"${flag('checked', opts.on)} />
    <span class="gl" aria-hidden="true">${opts.on ? '[■]' : '[ ]'}</span>
    <span><b>${opts.label} ${mod(opts.mod)}</b><small>${opts.help}</small></span>
  </label>`;
}

export function chip(opts: { label: string; on: boolean; action: string; value: string }): Html {
  return html`<button class="${cls('chip', opts.on && 'on')}" data-click="${opts.action}" data-value="${opts.value}" aria-pressed="${String(opts.on)}">${opts.label}</button>`;
}

/** A stack of key caps from "Ctrl + Shift + F13". */
export function keycaps(combo: string): Html {
  return html`${combo.split(' + ').map((k) => html`<span class="key">${k}</span>`)}`;
}
