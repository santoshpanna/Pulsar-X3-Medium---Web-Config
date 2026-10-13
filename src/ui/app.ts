import { webHidSupported } from '../protocol/webhid';
import { dockActions } from './chrome/dock';
import { headerActions } from './chrome/header';
import type { Ctx } from './context';
import { Controller } from './controller';
import { Router } from './dom/events';
import { morph } from './dom/morph';
import { connectActions } from './screens/connect';
import { SECTIONS } from './sections';
import { cloneSettings, type Settings } from './settings';
import { initialState, pendingChanges, type AppState, type Theme, type ToastKind } from './state';
import { Store } from './store';
import { renderApp } from './view';

const THEME_KEY = 'pulsar-x3.theme';

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const activeDpi = (d: Settings) => d.dpi.stages[d.dpi.active - 1]?.x;

/**
 * Wires the pieces together: state lives in the Store, the Controller talks
 * to the mouse, the Router turns DOM events into named actions, and every
 * state change re-renders the page (once per frame) through `morph`.
 */
export class App {
  private store: Store<AppState>;
  private device: Controller;
  private ctx: Ctx;
  private frame = 0;
  private toastId = 0;
  private toastTimer: number | undefined;
  private scrambleTimer: number | undefined;

  constructor(private root: HTMLElement) {
    this.store = new Store(initialState(webHidSupported(), loadTheme()));
    this.device = new Controller(this.store, {
      toast: (msg, kind) => this.toast(msg, kind),
      ready: (draft) => {
        const dpi = activeDpi(draft);
        if (dpi !== undefined) this.scramble(dpi);
      },
    });
    const store = this.store;
    this.ctx = {
      store,
      device: this.device,
      get: () => store.get(),
      ui: (patch) => store.set((s) => ({ ui: { ...s.ui, ...patch } })),
      stage: (edit) => {
        const { draft, busy } = store.get();
        if (!draft || busy) return;
        const next = cloneSettings(draft);
        edit(next);
        store.set({ draft: next });
      },
      toast: (msg, kind = 'info') => this.toast(msg, kind),
      scramble: (dpi) => this.scramble(dpi),
    };
  }

  start(): void {
    const router = new Router(this.root, this.ctx, (hold) => this.ctx.ui({ hold }));
    router.register(headerActions).register(dockActions).register(connectActions);
    for (const sec of SECTIONS) if (sec.actions) router.register(sec.actions);
    router.listen();

    window.addEventListener('keydown', (e) => this.onShortcut(e));
    // Warn before leaving with staged, unapplied edits.
    window.addEventListener('beforeunload', (e) => {
      if (pendingChanges(this.store.get()).length) { e.preventDefault(); e.returnValue = ''; }
    });

    let theme = this.store.get().ui.theme;
    this.applyTheme(theme);
    this.store.subscribe((s) => {
      if (s.ui.theme !== theme) {
        theme = s.ui.theme;
        this.applyTheme(theme);
      }
      this.schedule();
    });
    // Keep "applied 2 min ago" honest.
    window.setInterval(() => { if (this.store.get().applied) this.schedule(); }, 15_000);

    this.render();
    this.device.start();
  }

  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render() {
    const before = this.root.querySelector<HTMLElement>('[data-stick-bottom]');
    const pinned = !before || before.scrollTop + before.clientHeight >= before.scrollHeight - 24;

    morph(this.root, renderApp(this.store.get()).value);

    const term = this.root.querySelector<HTMLElement>('[data-stick-bottom]');
    if (term && pinned) term.scrollTop = term.scrollHeight;
    const auto = this.root.querySelector<HTMLElement>('[data-autofocus]');
    if (auto && document.activeElement !== auto) auto.focus();
  }

  private applyTheme(theme: Theme) {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  }

  private toast(msg: string, kind: ToastKind) {
    const id = ++this.toastId;
    const ms = kind === 'err' ? 7000 : 2800;
    this.store.set({ toast: { id, msg, kind, ms } });
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      if (this.store.get().toast?.id === id) this.store.set({ toast: null });
    }, ms);
  }

  /** Roll the hero digits through random values, locking in left to right. */
  private scramble(dpi: number) {
    clearInterval(this.scrambleTimer);
    if (reducedMotion()) { this.ctx.ui({ scramble: null }); return; }
    const target = String(dpi);
    let frame = 0;
    this.scrambleTimer = window.setInterval(() => {
      frame++;
      if (frame > 10) {
        clearInterval(this.scrambleTimer);
        this.ctx.ui({ scramble: null });
        return;
      }
      const locked = Math.max(0, frame - 5);
      const digits = Array.from(target, (ch, i) => (i < locked ? ch : String(Math.floor(Math.random() * 10)))).join('');
      this.ctx.ui({ scramble: digits });
    }, 45);
  }

  /** Ctrl/Cmd+S or Ctrl/Cmd+Enter applies the draft. */
  private onShortcut(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== 's' && e.key !== 'Enter')) return;
    if ((e.target as HTMLElement | null)?.closest?.('.cap')) return; // the capture field owns its keys
    if (!pendingChanges(this.store.get()).length) return;
    e.preventDefault();
    this.device.apply();
  }
}
