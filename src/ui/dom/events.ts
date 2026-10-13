/**
 * Delegated event routing. Markup names what should happen, code registers
 * how: `<button data-click="dpi.add">` runs the handler registered as
 * `dpi.add`. One listener per event type on the root, so re-rendered nodes
 * never need re-binding.
 *
 * Supported attributes: data-click, data-input, data-change, data-keydown,
 * data-focusout, plus two behaviours that span several events:
 *   data-hold="name"   press and hold (pointer, Space or Enter) to confirm
 *   data-drop="name"   a file drop target
 */

export interface ActionEvent {
  el: HTMLElement;
  event: Event;
  /** `data-value` if present, else the element's own value (inputs, buttons). */
  value: string;
  files?: FileList;
}

export type Handler<C> = (ctx: C, e: ActionEvent) => void;
export type Actions<C> = Record<string, Handler<C>>;

const ROUTED = ['click', 'input', 'change', 'keydown', 'focusout'] as const;

export interface HoldProgress {
  name: string;
  pct: number;
}

export class Router<C> {
  private handlers = new Map<string, Handler<C>>();
  private hold: { name: string; el: HTMLElement; timer: number; pct: number } | null = null;

  constructor(
    private root: HTMLElement,
    private ctx: C,
    private onHold: (p: HoldProgress | null) => void = () => undefined,
  ) {}

  register(actions: Actions<C>): this {
    for (const [name, h] of Object.entries(actions)) {
      if (this.handlers.has(name)) throw new Error(`Duplicate action "${name}"`);
      this.handlers.set(name, h);
    }
    return this;
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  listen(): this {
    for (const type of ROUTED) this.root.addEventListener(type, (ev) => this.dispatch(type, ev));
    this.listenHold();
    this.listenDrop();
    return this;
  }

  private run(name: string, el: HTMLElement, event: Event, files?: FileList) {
    const h = this.handlers.get(name);
    if (!h) {
      console.warn(`No handler registered for "${name}"`);
      return;
    }
    const value = el.dataset.value ?? ('value' in el ? String((el as HTMLInputElement).value) : '');
    h(this.ctx, { el, event, value, files });
  }

  private dispatch(type: string, event: Event) {
    const el = (event.target as Element | null)?.closest<HTMLElement>(`[data-${type}]`);
    if (!el || !this.root.contains(el)) return;
    if (el.matches(':disabled')) return;
    this.run(el.getAttribute(`data-${type}`)!, el, event);
  }

  // ── press-and-hold ──────────────────────────────────────────────────────

  private listenHold() {
    const start = (el: HTMLElement, event: Event) => {
      if (this.hold || el.matches(':disabled')) return;
      const ms = Number(el.dataset.holdMs ?? 1500);
      const name = el.dataset.hold!;
      const began = performance.now();
      const tick = () => {
        if (!this.hold) return;
        const pct = Math.min(100, ((performance.now() - began) / ms) * 100);
        this.hold.pct = pct;
        this.onHold({ name, pct });
        if (pct >= 100) {
          this.cancelHold();
          this.run(name, el, event);
        }
      };
      this.hold = { name, el, pct: 0, timer: window.setInterval(tick, 40) };
      this.onHold({ name, pct: 0 });
    };
    this.root.addEventListener('pointerdown', (ev) => {
      const el = (ev.target as Element).closest<HTMLElement>('[data-hold]');
      if (!el || (ev as PointerEvent).button !== 0) return;
      ev.preventDefault();
      el.focus();
      start(el, ev);
      el.addEventListener('pointerleave', () => this.cancelHold(), { once: true });
    });
    window.addEventListener('pointerup', () => this.cancelHold());
    window.addEventListener('pointercancel', () => this.cancelHold());
    this.root.addEventListener('keydown', (ev) => {
      const el = (ev.target as Element).closest<HTMLElement>('[data-hold]');
      if (!el || (ev.key !== ' ' && ev.key !== 'Enter')) return;
      ev.preventDefault();
      if (!ev.repeat) start(el, ev);
    });
    this.root.addEventListener('keyup', (ev) => {
      if (ev.key === ' ' || ev.key === 'Enter') this.cancelHold();
    });
  }

  private cancelHold() {
    if (!this.hold) return;
    clearInterval(this.hold.timer);
    this.hold = null;
    this.onHold(null);
  }

  // ── file drop ───────────────────────────────────────────────────────────

  private listenDrop() {
    const zone = (ev: Event) => (ev.target as Element | null)?.closest?.<HTMLElement>('[data-drop]') ?? null;
    this.root.addEventListener('dragover', (ev) => {
      const el = zone(ev);
      if (!el) return;
      ev.preventDefault();
      el.classList.add('is-over');
    });
    this.root.addEventListener('dragleave', (ev) => zone(ev)?.classList.remove('is-over'));
    this.root.addEventListener('drop', (ev) => {
      const el = zone(ev);
      if (!el) return;
      ev.preventDefault();
      el.classList.remove('is-over');
      const files = (ev as DragEvent).dataTransfer?.files;
      if (files?.length) this.run(el.dataset.drop!, el, ev, files);
    });
  }
}
