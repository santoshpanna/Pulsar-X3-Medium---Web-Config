import { CODE_TO_HID, Mod, keyboardBinding, type Binding } from '../protocol/buttons';

export type KeyLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>;

export type Capture =
  | { kind: 'cancel' }
  /** Only modifiers held so far; keep listening. `preview` is e.g. "Ctrl + Shift + …". */
  | { kind: 'modifier'; preview: string }
  | { kind: 'unsupported'; code: string }
  | { kind: 'bound'; binding: Binding };

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

export function modifierNames(e: KeyLike): string[] {
  const out: string[] = [];
  if (e.ctrlKey) out.push('Ctrl');
  if (e.shiftKey) out.push('Shift');
  if (e.altKey) out.push('Alt');
  if (e.metaKey) out.push('Win');
  return out;
}

/** Turn one keydown in the capture field into what the field should do next. */
export function captureKey(e: KeyLike): Capture {
  if (e.code === 'Escape') return { kind: 'cancel' };
  if (MODIFIER_CODES.has(e.code)) return { kind: 'modifier', preview: [...modifierNames(e), '…'].join(' + ') };
  const usage = CODE_TO_HID[e.code];
  if (usage === undefined) return { kind: 'unsupported', code: e.code };
  let mods = 0;
  if (e.ctrlKey) mods |= Mod.Ctrl;
  if (e.shiftKey) mods |= Mod.Shift;
  if (e.altKey) mods |= Mod.Alt;
  if (e.metaKey) mods |= Mod.Gui;
  return { kind: 'bound', binding: keyboardBinding(mods, usage) };
}
