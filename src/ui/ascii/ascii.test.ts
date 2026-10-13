import { describe, expect, it } from 'vitest';
import { DPI_MAX, DPI_MIN } from '../../protocol/device';
import { FIGLET_ROWS, figlet } from './figlet';
import { figletSize, figletSvg } from './figlet-svg';
import { meter, sparkline } from './glyphs';
import { SCALE_MAX, dpiPct, dpiToPos, posToDpi, snapDpi } from './scale';

describe('figlet', () => {
  it('renders six rows of equal width', () => {
    const rows = figlet('32000');
    expect(rows).toHaveLength(FIGLET_ROWS);
    expect(new Set(rows.map((r) => r.length)).size).toBe(1);
  });

  it('widens with the number of glyphs', () => {
    expect(figlet('800')[0].length).toBeLessThan(figlet('8000')[0].length);
  });

  it('falls back to "?" for unknown characters', () => {
    expect(figlet('#')).toEqual(figlet('?'));
  });
});

describe('glyphs', () => {
  it('draws a fixed-width meter', () => {
    expect(meter(51)).toBe('[█████░░░░░]');
    expect(meter(0)).toBe('[░░░░░░░░░░]');
    expect(meter(140)).toBe('[██████████]');
  });

  it('scales a sparkline between its bounds', () => {
    expect(sparkline([70, 85, 100], 70, 100)).toBe('▁▅█');
    expect(sparkline([0, 200], 70, 100)).toBe('▁█');
  });
});

describe('DPI log scale', () => {
  it('maps the ends of the range to the ends of the slider', () => {
    expect(dpiToPos(DPI_MIN)).toBe(0);
    expect(dpiToPos(DPI_MAX)).toBe(SCALE_MAX);
    expect(posToDpi(0)).toBe(DPI_MIN);
    expect(posToDpi(SCALE_MAX)).toBe(DPI_MAX);
  });

  it('round-trips common values within one step', () => {
    for (const dpi of [100, 400, 800, 1600, 3200, 6400, 26000]) {
      expect(Math.abs(posToDpi(dpiToPos(dpi)) - dpi) / dpi).toBeLessThan(0.01);
    }
  });

  it('gives low DPI a usable share of the travel', () => {
    expect(dpiPct(1000)).toBeGreaterThan(40);
  });

  it('snaps to the 10 DPI grid and clamps', () => {
    expect(snapDpi(803)).toBe(800);
    expect(snapDpi(1)).toBe(DPI_MIN);
    expect(snapDpi(99999)).toBe(DPI_MAX);
    expect(snapDpi(Number.NaN)).toBe(DPI_MIN);
  });
});

describe('figletSvg', () => {
  it('draws solid runs as merged rects and shadows as strokes, one group per row', () => {
    const svg = figletSvg('800');
    expect(svg.match(/<g class="ln"/g)).toHaveLength(FIGLET_ROWS);
    expect(svg).toContain('<rect class="fb"');
    expect(svg).toContain('<path class="fs"');
    expect(svg).not.toMatch(/NaN|undefined/);
    const { cols } = figletSize('800');
    expect(svg).toContain(`viewBox="0 0 ${cols * 10} ${FIGLET_ROWS * 20}"`);
  });
});
