import { html, pad2, type Html } from '../dom/html';
import type { LiveView, Section } from '../sections/types';

export function stagedIn(section: Section, v: LiveView): number {
  return section.owns ? v.changes.filter((c) => section.owns!(c.key)).length : 0;
}

/** Side nav: one anchor per section, with its count of staged edits. */
export function rail(sections: readonly Section[], v: LiveView): Html {
  return html`<nav class="rail" aria-label="Sections">
    ${sections.map((sec, i) => {
      const n = stagedIn(sec, v);
      return html`<a href="#sec-${sec.id}"><span class="n">${pad2(i + 1)}</span><span>${sec.nav ?? sec.title}</span><span class="ld" aria-hidden="true"></span>${n ? html`<span class="mod" title="${n} staged">*${n}</span>` : ''}</a>`;
    })}
    <div class="rail-foot">Stage edits freely.<br>Nothing is written until you apply.<br><br><span class="kbd">Ctrl</span> + <span class="kbd">S</span> applies</div>
  </nav>`;
}
