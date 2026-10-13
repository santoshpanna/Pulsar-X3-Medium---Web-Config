import { buttonsSection } from './buttons';
import { diagnosticsSection } from './diagnostics';
import { dpiSection } from './dpi';
import { performanceSection } from './performance';
import { powerSection } from './power';
import { profileSection } from './profile';
import type { Section } from './types';

/**
 * The editor's panels, in page order. Numbering, the side nav and the
 * per-section "staged" counts all derive from this list.
 */
export const SECTIONS: readonly Section[] = [
  dpiSection,
  performanceSection,
  buttonsSection,
  powerSection,
  profileSection,
  diagnosticsSection,
];

/** The section that edits a change key, if any. */
export function sectionOf(key: string): Section | undefined {
  return SECTIONS.find((s) => s.owns?.(key));
}

export type { LiveView, Section } from './types';
