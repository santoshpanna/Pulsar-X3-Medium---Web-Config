/** Character-cell building blocks: bars, sparklines, rules. */

export const SHADE = '░';
export const BLOCK = '█';
export const RULE = '─';

/** Enough cells to overfill any bar; the container clips it to its width. */
export const FILL_CELLS = 220;
export const SHADE_RUN = SHADE.repeat(FILL_CELLS);
export const BLOCK_RUN = BLOCK.repeat(FILL_CELLS);
export const RULE_RUN = RULE.repeat(FILL_CELLS);

/** A fixed-width text bar: `[█████░░░░░]`. */
export function meter(pct: number, cells = 10): string {
  const n = Math.round((clamp(pct, 0, 100) / 100) * cells);
  return `[${BLOCK.repeat(n)}${SHADE.repeat(cells - n)}]`;
}

const SPARK = '▁▂▃▄▅▆▇█';

/** One character per sample, scaled between `lo` and `hi`. */
export function sparkline(values: readonly number[], lo = 0, hi = 100): string {
  const span = Math.max(1, hi - lo);
  return values.map((v) => SPARK[Math.round((clamp(v, lo, hi) - lo) / span * (SPARK.length - 1))]).join('');
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
