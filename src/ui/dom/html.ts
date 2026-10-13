/**
 * Tiny HTML templating. `html` escapes every interpolated value unless it is
 * already `Html` (another template, or `raw()`), so views compose without
 * double-escaping and without ever building markup from unescaped strings.
 */

export class Html {
  constructor(readonly value: string) {}
  toString(): string { return this.value; }
}

export type Child = Html | string | number | boolean | null | undefined | readonly Child[];

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function flatten(v: Child): string {
  if (v === null || v === undefined || typeof v === 'boolean') return '';
  if (v instanceof Html) return v.value;
  if (Array.isArray(v)) return v.map(flatten).join('');
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: Child[]): Html {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += flatten(values[i]) + strings[i + 1];
  return new Html(out);
}

/** Trusted markup, inserted as-is. Never pass user or device data here. */
export const raw = (s: string): Html => new Html(s);

/** Class list from conditional parts: `cls('btn', on && 'on')`. */
export const cls = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

/** A boolean attribute (`disabled`, `checked`, …) when `on`. */
export const flag = (name: string, on: boolean | undefined): Html => raw(on ? ` ${name}` : '');

export const pad2 = (n: number): string => String(n).padStart(2, '0');
