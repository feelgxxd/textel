// Animated SVG from a recording: plays without scripts, so it works inside an <img>, a GitHub README
// included. Each frame is a group of text rows; one CSS animation shows the frames in turn.
import type { Recording } from './format.ts';

/** Options of recordingSVG. */
export interface SVGOptions {
  /** width of one character cell in pixels; its height is width × the recording's aspect (default 8) */
  cell?: number;
  /** text color; default: dark on light pages and light on dark pages, unless the recording has a background */
  color?: string;
  /** background color; default: the recording's own, or none (transparent) */
  background?: string | null;
  /** opacity of dim cells (default 0.6, as in the player) */
  dim?: number;
  /** font stack; the rows are stretched to the grid, so any monospace font lines up (default: system monospace) */
  font?: string;
  /** accessible title */
  title?: string;
}

const FONT = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => String(Math.round(v * 100) / 100);
// timing needs more digits: rounded delays would let two frames overlap for a few milliseconds
const t = (v: number) => String(Math.round(v * 1e4) / 1e4);

/** The whole recording as one self-contained, looping SVG document. */
export function recordingSVG(rec: Recording, opts: SVGOptions = {}): string {
  const { width: W, height: H, glyphs } = rec;
  const cw = opts.cell ?? 8, ch = cw * rec.aspect;
  const bg = opts.background === undefined ? rec.bg : opts.background;
  const dim = opts.dim ?? 0.6;
  const count = rec.frames.length, dur = count / rec.fps;
  const styles = rec.styles ?? [''];

  // with no color and no background given, the text follows the reader's light or dark theme
  const fill = opts.color ?? (bg ? (lum(bg) > 0.5 ? '#111' : '#eee') : '#24292f');
  const themed = !opts.color && !bg;
  const css = [
    `text{font-family:${xml(opts.font ?? FONT)};font-size:${n(ch)}px;white-space:pre;fill:${xml(fill)}}`,
    themed ? '@media (prefers-color-scheme:dark){text{fill:#e6edf3}}' : '',
    '.d{fill-opacity:' + dim + '}',
    // one short class per color, since a gradient repeats them thousands of times
    ...styles.map((st, i) => (st.startsWith('#') ? `.c${i.toString(36)}{fill:${xml(st)}}` : '')),
    count > 1
      ? `.f{visibility:hidden;animation:t ${t(dur)}s steps(1,end) infinite}` +
        `@keyframes t{0%{visibility:visible}${t(100 / count)}%{visibility:hidden}}` +
        // without motion, the first frame stays
        '@media (prefers-reduced-motion:reduce){.f{animation:none}#f0{visibility:visible}}'
      : '',
  ].join('');

  const out: string[] = [];
  const w = W * cw, h = H * ch;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}" role="img"${opts.title ? ` aria-label="${xml(opts.title)}"` : ''}>`);
  if (opts.title) out.push(`<title>${xml(opts.title)}</title>`);
  out.push(`<style>${css}</style>`);
  if (bg) out.push(`<rect width="100%" height="100%" fill="${xml(bg)}"/>`);

  // runs of one style become tspans: a color, or the dim class
  const open = styles.map((st, i) => (st === '' ? '' : st === '~' ? '<tspan class="d">' : `<tspan class="c${i.toString(36)}">`));
  for (let f = 0; f < count; f++) {
    const { glyph, style } = rec.frames[f];
    out.push(count > 1 ? `<g class="f" id="f${f}" style="animation-delay:${t((f * dur) / count)}s">` : '<g>');
    for (let r = 0; r < H; r++) {
      const at = r * W;
      // trim blank cells at both ends; the row is placed and stretched to the grid instead
      let a = 0, b = W;
      while (a < b && glyphs[glyph[at + a]] === ' ') a++;
      while (b > a && glyphs[glyph[at + b - 1]] === ' ') b--;
      if (a === b) continue;
      let s = '', cur = 0;
      for (let c = a; c < b; c++) {
        const i = at + c, g = glyphs[glyph[i]];
        // a blank keeps whatever style is open, so runs stay long
        const st = style && g !== ' ' ? style[i] : cur;
        if (st !== cur) {
          if (cur) s += '</tspan>';
          s += open[st];
          cur = st;
        }
        s += xml(g);
      }
      if (cur) s += '</tspan>';
      out.push(`<text x="${n(a * cw)}" y="${n(r * ch + ch * 0.8)}" textLength="${n((b - a) * cw)}" lengthAdjust="spacingAndGlyphs">${s}</text>`);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}

/** relative luminance of a #rrggbb color, 0..1 */
function lum(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
