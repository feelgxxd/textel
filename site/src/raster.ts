// Draws recorded frames as pixels, for GIF and video: every glyph in its own cell, so any font lines up.
import type { Recording } from '../../src/frames.ts';

export interface PixelLook {
  /** cell width in pixels; the height is width × the recording's aspect */
  cell: number;
  /** text color for cells without one */
  color: string;
  background: string;
  /** opacity of dim cells */
  dim?: number;
  font?: string;
  /** round the size to even numbers (video encoders need it) */
  even?: boolean;
}

const FONT = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

export interface Raster {
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  /** draws frame `i` onto the canvas */
  draw(i: number): CanvasRenderingContext2D;
  /** the colors frames can contain, as 0xRRGGBB: the background and every text color at full strength */
  inks: number[];
}

export function rasterize(rec: Recording, look: PixelLook): Raster {
  const cw = look.cell, ch = cw * rec.aspect;
  let width = Math.round(rec.width * cw), height = Math.round(rec.height * ch);
  if (look.even) { width += width & 1; height += height & 1; }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const dim = look.dim ?? 0.6;
  const styles = rec.styles ?? [''];
  const fill = styles.map((st) => (st === '' || st === '~' ? look.color : st));
  const alpha = styles.map((st) => (st === '~' ? dim : 1));

  ctx.font = `${ch}px ${look.font ?? FONT}`;
  // squeeze or widen glyphs to the cell: the font's own width rarely matches it
  const sx = cw / (ctx.measureText('M').width || cw);

  const inks = new Set<number>([hex(look.background)]);
  styles.forEach((_, i) => inks.add(alpha[i] < 1 ? mix(hex(look.background), hex(fill[i]), alpha[i]) : hex(fill[i])));

  return {
    width, height, canvas, inks: [...inks],
    draw(i) {
      const { glyph, style } = rec.frames[i];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = look.background;
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${ch}px ${look.font ?? FONT}`;
      ctx.textBaseline = 'alphabetic';
      ctx.setTransform(sx, 0, 0, 1, 0, 0);
      let cur = -1;
      for (let r = 0; r < rec.height; r++) {
        const y = r * ch + ch * 0.8;
        for (let c = 0; c < rec.width; c++) {
          const k = r * rec.width + c, g = rec.glyphs[glyph[k]];
          if (g === ' ') continue;
          const st = style ? style[k] : 0;
          if (st !== cur) { ctx.fillStyle = fill[st]; ctx.globalAlpha = alpha[st]; cur = st; }
          ctx.fillText(g, (c * cw) / sx, y);
        }
      }
      return ctx;
    },
  };
}

const hex = (s: string) => parseInt(s.slice(1, 7), 16);
const mix = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/**
 * A palette for text on a flat background: each ink blended into the background at several strengths,
 * which covers the soft edges of antialiased glyphs. Pixels map to the nearest entry.
 */
export function inkPalette(inks: number[]): { palette: number[]; index(rgb: number): number } {
  const [bg, ...rest] = inks;
  let palette: number[];
  if (rest.length * 4 <= 254) {
    const levels = Math.min(16, Math.floor(254 / Math.max(1, rest.length)));
    palette = [bg];
    for (const ink of rest) for (let l = 1; l <= levels; l++) palette.push(mix(bg, ink, l / levels));
  } else {
    // too many inks (a smooth gradient): a plain color cube, plus the background exactly
    palette = [bg];
    for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) palette.push(((r * 51) << 16) | (Math.round(g * 42.5) << 8) | (b * 51));
    palette.length = Math.min(palette.length, 255);
  }
  palette = [...new Set(palette)];
  const cache = new Map<number, number>();
  return {
    palette,
    index(rgb) {
      let best = cache.get(rgb);
      if (best !== undefined) return best;
      let d = Infinity;
      const r = rgb >> 16, g = (rgb >> 8) & 255, b = rgb & 255;
      for (let i = 0; i < palette.length; i++) {
        const p = palette[i], dr = r - (p >> 16), dg = g - ((p >> 8) & 255), db = b - (p & 255);
        const e = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (e < d) { d = e; best = i; }
      }
      cache.set(rgb, best!);
      return best!;
    },
  };
}

/** the canvas as palette indices */
export function indexed(ctx: CanvasRenderingContext2D, width: number, height: number, pal: ReturnType<typeof inkPalette>): Uint8Array {
  const px = ctx.getImageData(0, 0, width, height).data, out = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = pal.index((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
  return out;
}
