import { figlet } from './figlet';

/**
 * Draw figlet rows as SVG instead of text. Fonts disagree about block and
 * box-drawing glyphs (widths, seams between cells, synthetic bold), and at
 * hero sizes those flaws show. Here every cell is geometry on an exact grid:
 * █ runs become rectangles, the double-line "shadow" glyphs become strokes.
 */

const W = 10;
const H = 20;
/** Double-line strokes sit at these fractions of the cell. */
const A = 0.3;
const B = 0.7;

type Seg = [number, number, number, number];

/** Line segments for each double-line glyph, in cell fractions. */
const LINES: Record<string, Seg[][]> = {
  '═': [[[0, A, 1, A]], [[0, B, 1, B]]],
  '║': [[[A, 0, A, 1]], [[B, 0, B, 1]]],
  '╗': [[[0, A, B, A], [B, A, B, 1]], [[0, B, A, B], [A, B, A, 1]]],
  '╔': [[[1, A, A, A], [A, A, A, 1]], [[1, B, B, B], [B, B, B, 1]]],
  '╝': [[[0, B, B, B], [B, B, B, 0]], [[0, A, A, A], [A, A, A, 0]]],
  '╚': [[[1, B, A, B], [A, B, A, 0]], [[1, A, B, A], [B, A, B, 0]]],
};

const f = (n: number) => +n.toFixed(2);

function rowSvg(row: string, y: number): string {
  const parts: string[] = [];
  const chars = Array.from(row);
  for (let x = 0; x < chars.length; x++) {
    const ch = chars[x];
    if (ch === '█' || ch === '▀' || ch === '▄') {
      // Merge a horizontal run of the same block into one rect: no seams.
      let end = x;
      while (chars[end + 1] === ch) end++;
      const top = ch === '▄' ? H / 2 : 0;
      const h = ch === '█' ? H : H / 2;
      parts.push(`<rect class="fb" x="${x * W}" y="${y * H + top}" width="${(end - x + 1) * W}" height="${h + 0.4}"/>`);
      x = end;
      continue;
    }
    const lines = LINES[ch];
    if (!lines) continue;
    // Each stroke is a polyline: move to the first point, then line through each segment's end.
    const d = lines
      .map((path) => `M${f((x + path[0][0]) * W)} ${f((y + path[0][1]) * H)}${path.map(([, , x2, y2]) => ` L${f((x + x2) * W)} ${f((y + y2) * H)}`).join('')}`)
      .join(' ');
    parts.push(`<path class="fs" d="${d}"/>`);
  }
  return parts.join('');
}

/** Width/height of the rendered text in grid units, for sizing. */
export function figletSize(text: string): { cols: number; rows: number } {
  const rows = figlet(text);
  return { cols: Math.max(...rows.map((r) => Array.from(r).length)), rows: rows.length };
}

/**
 * SVG markup for `text` (trusted: built only from the glyph table). Each row
 * is a `<g class="ln">` with `--r` set, so CSS can stagger row animations.
 */
export function figletSvg(text: string): string {
  const rows = figlet(text);
  const { cols } = figletSize(text);
  const body = rows.map((row, r) => `<g class="ln" style="--r:${r}">${rowSvg(row, r)}</g>`).join('');
  return `<svg class="figsvg" viewBox="0 0 ${cols * W} ${rows.length * H}" preserveAspectRatio="xMinYMin meet" aria-hidden="true" focusable="false">${body}</svg>`;
}
