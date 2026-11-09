// The parts of <textel-viewer> that do not touch the DOM, so they can be tested anywhere.

export interface Grid {
  cols: number;
  rows: number;
  /** cell height / width of the page font, handed to the renderer so nothing has to be stretched */
  aspect: number;
  /** transform scale that makes the grid fill the box width */
  scale: number;
  /** width / height of the drawn grid, for an auto-height box */
  ratio: number;
}

/**
 * The grid for a box: `cols` is fixed, rows follow from the box shape in this font.
 * A box without a height gets a square picture.
 */
export function gridFor(cols: number, cellW: number, cellH: number, boxW: number, boxH: number): Grid {
  const c = Math.max(8, Math.round(cols));
  const cw = cellW > 0 ? cellW : 0.6, ch = cellH > 0 ? cellH : 1;
  const wantRatio = boxW > 0 && boxH > 0 ? boxW / boxH : 1;
  const rows = Math.max(4, Math.min(400, Math.round((c * cw) / (ch * wantRatio))));
  const w = c * cw, h = rows * ch;
  return { cols: c, rows, aspect: ch / cw, scale: boxW > 0 ? boxW / w : 1, ratio: w / h };
}

export interface Motion {
  yaw: number;
  pitch: number;
  /** radians per second */
  vyaw: number;
  vpitch: number;
}

export interface MotionTarget {
  /** resting spin, radians per second (0 when paused or reduced motion) */
  spin: number;
  /** resting pitch */
  pitch: number;
  /** how far people may tilt it either way */
  maxPitch: number;
}

const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/**
 * Advances the turntable by `dt` seconds. After a drag the flick keeps going and eases back to the
 * resting spin, and the tilt drifts back to the resting pitch.
 */
export function step(m: Motion, t: MotionTarget, dt: number): Motion {
  const d = Math.min(Math.max(dt, 0), 0.1);
  const vyaw = m.vyaw + (t.spin - m.vyaw) * ease(2, d);
  const vpitch = m.vpitch * (1 - ease(4, d));
  let pitch = m.pitch + vpitch * d;
  pitch += (t.pitch - pitch) * ease(1.5, d);
  pitch = Math.max(-t.maxPitch, Math.min(t.maxPitch, pitch));
  return { yaw: m.yaw + vyaw * d, pitch, vyaw, vpitch };
}

/**
 * A pointer moved by (dx, dy) pixels over `dt` seconds on a box `width` wide: a drag across the
 * whole width turns the model once. The speed is kept so a release turns into a flick.
 */
export function drag(m: Motion, dx: number, dy: number, dt: number, width: number, maxPitch: number): Motion {
  const k = width > 0 ? (Math.PI * 2) / width : 0.01;
  const dyaw = dx * k, dpitch = dy * k;
  const pitch = Math.max(-maxPitch, Math.min(maxPitch, m.pitch + dpitch));
  const inv = dt > 0.001 ? 1 / dt : 0;
  return { yaw: m.yaw + dyaw, pitch, vyaw: dyaw * inv, vpitch: dpitch * inv };
}

/** attribute values to style fields; unknown or empty values are left out */
export function styleFromAttributes(get: (name: string) => string | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const n = (name: string) => {
    const v = get(name);
    if (v === null || v.trim() === '') return undefined;
    const x = Number(v);
    return Number.isFinite(x) ? x : undefined;
  };
  const charset = get('charset');
  if (charset) out.charset = charset;
  const chars = get('chars');
  if (chars) out.chars = chars;
  const color = get('color');
  if (color) out.color = color.includes(',') ? color.split(',').map((s) => s.trim()) : color.trim();
  const edges = get('edges');
  if (edges !== null) out.edges = edges === 'depth' || edges === 'crease' ? edges : edges === 'off' || edges === 'false' ? false : 'outline';
  for (const k of ['spin', 'pitch', 'zoom', 'distance', 'ambient'] as const) {
    const v = n(k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
