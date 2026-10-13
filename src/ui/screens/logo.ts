import { figletSvg } from '../ascii/figlet-svg';
import { cls, html, raw, type Html } from '../dom/html';

/** Block-letter text whose rows wipe in one after another. */
export function logo(text: string, opts: { dim?: boolean; label?: string } = {}): Html {
  return html`<div class="${cls('logo', opts.dim && 'dim')}" role="img" aria-label="${opts.label ?? text}">${raw(figletSvg(text))}</div>`;
}
