import { describe, expect, it } from 'vitest';
import { cls, flag, html, raw } from './html';

describe('html', () => {
  it('escapes interpolated values', () => {
    expect(html`<b title="${'"x"'}">${'<script>'}</b>`.value).toBe('<b title="&quot;x&quot;">&lt;script&gt;</b>');
  });

  it('nests templates and arrays without double-escaping', () => {
    const items = ['a&b', 'c'].map((s) => html`<i>${s}</i>`);
    expect(html`<p>${items}</p>`.value).toBe('<p><i>a&amp;b</i><i>c</i></p>');
  });

  it('drops null, undefined and booleans', () => {
    expect(html`${null}${undefined}${false}${true}${0}`.value).toBe('0');
  });

  it('passes raw markup through', () => {
    expect(html`${raw('<hr>')}`.value).toBe('<hr>');
  });

  it('builds class lists and boolean attributes', () => {
    expect(cls('a', false, 'b', null)).toBe('a b');
    expect(html`<input${flag('disabled', true)}${flag('checked', false)}>`.value).toBe('<input disabled>');
  });
});
