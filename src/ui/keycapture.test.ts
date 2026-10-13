import { describe, expect, it } from 'vitest';
import { BtnType, Mod, describeBinding } from '../protocol/buttons';
import { captureKey } from './keycapture';

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({
  code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods,
});

describe('captureKey', () => {
  it('cancels on Escape', () => {
    expect(captureKey(key('Escape'))).toEqual({ kind: 'cancel' });
  });

  it('keeps listening while only modifiers are held', () => {
    expect(captureKey(key('ShiftLeft', { ctrlKey: true, shiftKey: true }))).toEqual({ kind: 'modifier', preview: 'Ctrl + Shift + …' });
  });

  it('binds a key with its modifiers', () => {
    const r = captureKey(key('KeyC', { ctrlKey: true, altKey: true }));
    expect(r.kind).toBe('bound');
    if (r.kind !== 'bound') return;
    expect(r.binding).toEqual({ type: BtnType.Keyboard, a1: Mod.Ctrl | Mod.Alt, a2: 0x06 });
    expect(describeBinding(r.binding)).toBe('Ctrl + Alt + C');
  });

  it('rejects keys outside the HID table', () => {
    expect(captureKey(key('MediaPlayPause'))).toEqual({ kind: 'unsupported', code: 'MediaPlayPause' });
  });
});
