import { DPI_MAX, DPI_MIN, DPI_STEP } from '../../protocol/device';

/**
 * DPI sliders run on a log scale: 50 → 32 000 is a 640× range, and a linear
 * slider would spend 97% of its travel above 1000 DPI where few people play.
 * Positions are 0…SCALE_MAX so the slider stays an integer range input.
 */
export const SCALE_MAX = 1000;
const SPAN = Math.log(DPI_MAX / DPI_MIN);

export function snapDpi(v: number): number {
  if (!Number.isFinite(v)) return DPI_MIN;
  return Math.min(DPI_MAX, Math.max(DPI_MIN, Math.round(v / DPI_STEP) * DPI_STEP));
}

export function dpiToPos(dpi: number): number {
  return Math.round((SCALE_MAX * Math.log(snapDpi(dpi) / DPI_MIN)) / SPAN);
}

export function posToDpi(pos: number): number {
  return snapDpi(DPI_MIN * Math.exp((pos / SCALE_MAX) * SPAN));
}

/** Percentage along the bar for a DPI value (for tick labels and fills). */
export function dpiPct(dpi: number): number {
  return (dpiToPos(dpi) / SCALE_MAX) * 100;
}
