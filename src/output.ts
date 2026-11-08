import type { Frame } from './render.ts';
import { bg, FAINT, fg, line, type ColorDepth } from './ansi.ts';
import type { RGB } from './style.ts';

export type { ColorDepth };

/** Plain text, one line per row. */
export function toText(frame: Frame): string {
  const { width: W, height: H, chars } = frame;
  const rows: string[] = [];
  for (let r = 0; r < H; r++) rows.push(chars.slice(r * W, r * W + W).join(''));
  return rows.join('\n');
}

const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function gradient(stops: RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
  return lerp(stops[i], stops[i + 1], x - i);
}

/**
 * Color of one cell, or null when the style has no color for it (use the default color).
 * `faint` asks for a dimmed default color, for dim materials in colorless styles.
 */
export function cellColor(frame: Frame, i: number): { rgb: RGB | null; faint: boolean } {
  const m = frame.mat[i];
  if (m < 0) return { rgb: null, faint: false };
  const ms = frame.materials[m], cs = frame.style.color;
  let rgb: RGB | null = ms.color ?? (cs.mode === 'gradient' ? gradient(cs.stops, frame.lum[i]) : cs.mode === 'mono' ? cs.fg : null);
  if (!rgb) return { rgb: null, faint: ms.opacity < 1 };
  if (ms.opacity < 1) rgb = lerp(cs.bg ?? [0, 0, 0], rgb, ms.opacity);
  return { rgb: [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])], faint: false };
}

/** ANSI-colored lines for a terminal. Color codes are only written when they change. */
export function toANSI(frame: Frame, depth: ColorDepth = 'truecolor'): string[] {
  const { width: W, height: H, chars } = frame;
  const background = bg(frame.style.color.bg, depth);
  const code = (i: number) => {
    const { rgb, faint } = cellColor(frame, i);
    return rgb && depth !== 'none' ? fg(rgb, depth) : faint ? FAINT : '';
  };
  const lines: string[] = [];
  for (let r = 0; r < H; r++) lines.push(line((i) => chars[i], code, r * W, W, background));
  return lines;
}

const esc = (ch: string) => (ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch);
const hex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/** HTML for a `<pre>`: colored runs become spans. Without colors, dim materials get reduced opacity. */
export function toHTML(frame: Frame): string {
  const { width: W, height: H, chars } = frame;
  let s = '';
  for (let r = 0; r < H; r++) {
    let open = '';
    for (let c = 0; c < W; c++) {
      const i = r * W + c, ch = chars[i];
      if (ch !== ' ') {
        const { rgb, faint } = cellColor(frame, i);
        const m = frame.mat[i], op = m >= 0 ? frame.materials[m].opacity : 1;
        const attr = rgb ? `color:${hex(rgb)}` : faint ? `opacity:${op}` : '';
        if (attr !== open) {
          if (open) s += '</span>';
          if (attr) s += `<span style="${attr}">`;
          open = attr;
        }
      }
      s += esc(ch);
    }
    if (open) s += '</span>';
    if (r < H - 1) s += '\n';
  }
  return s;
}
