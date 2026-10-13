/** Button binding vocabulary of the Sonix/Fusion2 protocol (cat 0x04 reg 0x01 sub 0x06). */

export const BtnType = {
  Disabled: 0x00,
  Mouse: 0x01,
  Keyboard: 0x02,
  Scroll: 0x03,
  Profile: 0x08,
  Dpi: 0x09,
  Media: 0x0d,
  DoubleClick: 0x0e,
} as const;

export interface Binding {
  type: number;
  a1: number;
  a2: number;
}

export interface BindingOption {
  id: string;
  label: string;
  group: string;
  binding: Binding;
}

/** Physical buttons of the Pulsar X3 and their IDs on the wire. */
export const X3_BUTTONS: { id: number; key: string; label: string }[] = [
  { id: 0x01, key: 'left', label: 'Left click' },
  { id: 0x02, key: 'right', label: 'Right click' },
  { id: 0x03, key: 'wheel', label: 'Wheel click' },
  { id: 0x04, key: 'forward', label: 'Side front' },
  { id: 0x05, key: 'back', label: 'Side back' },
  { id: 0x0b, key: 'dpi', label: 'DPI button (bottom)' },
];

function media(usage: number): Binding {
  return { type: BtnType.Media, a1: usage & 0xff, a2: (usage >> 8) & 0xff };
}

export const BINDING_OPTIONS: BindingOption[] = [
  { id: 'left', label: 'Left click', group: 'Mouse', binding: { type: BtnType.Mouse, a1: 0x01, a2: 0 } },
  { id: 'right', label: 'Right click', group: 'Mouse', binding: { type: BtnType.Mouse, a1: 0x02, a2: 0 } },
  { id: 'wheel', label: 'Middle click', group: 'Mouse', binding: { type: BtnType.Mouse, a1: 0x03, a2: 0 } },
  { id: 'forward', label: 'Forward', group: 'Mouse', binding: { type: BtnType.Mouse, a1: 0x04, a2: 0 } },
  { id: 'back', label: 'Back', group: 'Mouse', binding: { type: BtnType.Mouse, a1: 0x05, a2: 0 } },
  { id: 'xclick', label: 'Double click', group: 'Mouse', binding: { type: BtnType.DoubleClick, a1: 0x01, a2: 0 } },
  { id: 'scrollup', label: 'Scroll up', group: 'Scroll', binding: { type: BtnType.Scroll, a1: 0x01, a2: 0 } },
  { id: 'scrolldown', label: 'Scroll down', group: 'Scroll', binding: { type: BtnType.Scroll, a1: 0xff, a2: 0 } },
  { id: 'dpiloop', label: 'DPI cycle', group: 'DPI', binding: { type: BtnType.Dpi, a1: 0x03, a2: 0 } },
  { id: 'dpi+', label: 'DPI up', group: 'DPI', binding: { type: BtnType.Dpi, a1: 0x01, a2: 0 } },
  { id: 'dpi-', label: 'DPI down', group: 'DPI', binding: { type: BtnType.Dpi, a1: 0x02, a2: 0 } },
  { id: 'profile+', label: 'Profile next', group: 'Profile', binding: { type: BtnType.Profile, a1: 0x03, a2: 0 } },
  { id: 'profile-', label: 'Profile previous', group: 'Profile', binding: { type: BtnType.Profile, a1: 0x04, a2: 0 } },
  { id: 'play', label: 'Play / pause', group: 'Media', binding: media(0x00cd) },
  { id: 'next', label: 'Next track', group: 'Media', binding: media(0x00b5) },
  { id: 'prev', label: 'Previous track', group: 'Media', binding: media(0x00b6) },
  { id: 'stop', label: 'Stop', group: 'Media', binding: media(0x00b7) },
  { id: 'mute', label: 'Mute', group: 'Media', binding: media(0x00e2) },
  { id: 'vol+', label: 'Volume up', group: 'Media', binding: media(0x00e9) },
  { id: 'vol-', label: 'Volume down', group: 'Media', binding: media(0x00ea) },
  { id: 'disabled', label: 'Disabled', group: 'Other', binding: { type: BtnType.Disabled, a1: 0, a2: 0 } },
];

export const KEYBOARD_OPTION_ID = 'keyboard';

/** HID keyboard modifier bits (payload a1 for type 0x02). */
export const Mod = { Ctrl: 0x01, Shift: 0x02, Alt: 0x04, Gui: 0x08, RCtrl: 0x10, RShift: 0x20, RAlt: 0x40, RGui: 0x80 } as const;

/** KeyboardEvent.code → HID usage (page 0x07). */
export const CODE_TO_HID: Record<string, number> = {
  KeyA: 0x04, KeyB: 0x05, KeyC: 0x06, KeyD: 0x07, KeyE: 0x08, KeyF: 0x09, KeyG: 0x0a, KeyH: 0x0b, KeyI: 0x0c,
  KeyJ: 0x0d, KeyK: 0x0e, KeyL: 0x0f, KeyM: 0x10, KeyN: 0x11, KeyO: 0x12, KeyP: 0x13, KeyQ: 0x14, KeyR: 0x15,
  KeyS: 0x16, KeyT: 0x17, KeyU: 0x18, KeyV: 0x19, KeyW: 0x1a, KeyX: 0x1b, KeyY: 0x1c, KeyZ: 0x1d,
  Digit1: 0x1e, Digit2: 0x1f, Digit3: 0x20, Digit4: 0x21, Digit5: 0x22, Digit6: 0x23, Digit7: 0x24, Digit8: 0x25,
  Digit9: 0x26, Digit0: 0x27,
  Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e,
  BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
  Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39,
  F1: 0x3a, F2: 0x3b, F3: 0x3c, F4: 0x3d, F5: 0x3e, F6: 0x3f, F7: 0x40, F8: 0x41, F9: 0x42, F10: 0x43, F11: 0x44, F12: 0x45,
  PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d,
  PageDown: 0x4e, ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52, NumLock: 0x53,
  NumpadDivide: 0x54, NumpadMultiply: 0x55, NumpadSubtract: 0x56, NumpadAdd: 0x57, NumpadEnter: 0x58,
  Numpad1: 0x59, Numpad2: 0x5a, Numpad3: 0x5b, Numpad4: 0x5c, Numpad5: 0x5d, Numpad6: 0x5e, Numpad7: 0x5f,
  Numpad8: 0x60, Numpad9: 0x61, Numpad0: 0x62, NumpadDecimal: 0x63,
  F13: 0x68, F14: 0x69, F15: 0x6a, F16: 0x6b, F17: 0x6c, F18: 0x6d, F19: 0x6e, F20: 0x6f, F21: 0x70, F22: 0x71,
  F23: 0x72, F24: 0x73,
};

function prettyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5) + ' arrow';
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export const HID_TO_LABEL: Record<number, string> = Object.fromEntries(
  Object.entries(CODE_TO_HID).map(([code, hid]) => [hid, prettyCode(code)]),
);

export function keyboardBinding(mods: number, hidUsage: number): Binding {
  return { type: BtnType.Keyboard, a1: mods & 0xff, a2: hidUsage & 0xff };
}

function sameBinding(a: Binding, b: Binding): boolean {
  return a.type === b.type && a.a1 === b.a1 && a.a2 === b.a2;
}

export function describeBinding(b: Binding): string {
  const opt = BINDING_OPTIONS.find((o) => sameBinding(o.binding, b));
  if (opt) return opt.label;
  if (b.type === BtnType.Keyboard) {
    const parts: string[] = [];
    if (b.a1 & (Mod.Ctrl | Mod.RCtrl)) parts.push('Ctrl');
    if (b.a1 & (Mod.Shift | Mod.RShift)) parts.push('Shift');
    if (b.a1 & (Mod.Alt | Mod.RAlt)) parts.push('Alt');
    if (b.a1 & (Mod.Gui | Mod.RGui)) parts.push('Win');
    parts.push(HID_TO_LABEL[b.a2] ?? `0x${b.a2.toString(16)}`);
    return parts.join(' + ');
  }
  return `type 0x${b.type.toString(16)} / 0x${b.a1.toString(16)} / 0x${b.a2.toString(16)}`;
}

export function findOptionId(b: Binding): string {
  const opt = BINDING_OPTIONS.find((o) => sameBinding(o.binding, b));
  if (opt) return opt.id;
  if (b.type === BtnType.Keyboard) return KEYBOARD_OPTION_ID;
  return '';
}
