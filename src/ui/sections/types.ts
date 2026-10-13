import type { AppActions } from '../context';
import type { Html } from '../dom/html';
import type { Change, Settings } from '../settings';
import type { AppState, DeviceInfo } from '../state';

/** Everything a section needs to render, with the connected-only fields non-null. */
export interface LiveView {
  s: AppState;
  /** The draft: what the controls show. */
  d: Settings;
  /** What the mouse holds. */
  m: Settings;
  info: DeviceInfo;
  changes: Change[];
  /** Keys of `changes`, for marking edited controls. */
  changed: Set<string>;
  busy: boolean;
}

/**
 * One numbered panel of the editor. The page frame (heading, number, staged
 * badge, side-nav entry) comes from the registry in `sections/index.ts`, so
 * adding a section is: write one of these, add it to the list.
 */
export interface Section {
  /** Stable id: anchor `#sec-<id>` and the action namespace by convention. */
  id: string;
  title: string;
  /** Short label for the side nav; defaults to the title. */
  nav?: string;
  /** Right-aligned note in the heading bar. */
  meta?: (v: LiveView) => string;
  /** Which change keys (see `diffSettings`) are edited in this section. */
  owns?: (key: string) => boolean;
  render(v: LiveView): Html;
  actions?: AppActions;
}
