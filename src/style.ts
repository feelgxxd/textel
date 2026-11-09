export type Vec3 = [number, number, number];
export type RGB = [number, number, number];

// Paul Bourke's 70-level ramp, flipped so it runs dark to bright like the others
const DETAILED = [...'$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'. '].reverse().join('');

/**
 * Character ramps, darkest first. A ramp that starts with a space lets shadows go empty
 * (crisp on flat faces); one that does not keeps the whole silhouette visible.
 */
export const CHARSETS: Record<string, string> = {
  classic: '.,-~:;=!*#$@',
  hard: ' .:-=+*#%@',
  detailed: DETAILED,
  blocks: ' ░▒▓█',
  dots: ' ·•●',
  minimal: ' .:-=',
};

/**
 * How a material is drawn.
 * - `solid`: the normal ramp
 * - `carved`: blank, but still hides what is behind it (holes, eye sockets, engravings)
 * - `dim`: the normal ramp at lower intensity
 */
export type MaterialInput =
  | 'solid'
  | 'carved'
  | 'dim'
  | { chars?: string; charset?: string; color?: string; opacity?: number; carved?: boolean };

export interface ResolvedMaterial {
  name: string;
  /** own ramp, or null for the style's */
  chars: string[] | null;
  color: RGB | null;
  opacity: number;
  carved: boolean;
}

/** `'none'`, a single `'#hex'` (mono), a list of hex stops (gradient by brightness) or the full object. */
export type ColorInput =
  | string
  | string[]
  | { mode?: 'none' | 'mono' | 'gradient'; fg?: string; stops?: string[]; bg?: string };

export interface ResolvedColor {
  mode: 'none' | 'mono' | 'gradient';
  fg: RGB;
  stops: RGB[];
  bg: RGB | null;
}

export type EdgeMode = false | 'outline' | 'depth' | 'crease';

/** Everything about the look. Every field is optional; see DEFAULTS. This is what a preset file holds. */
export interface StyleInput {
  /** grid size in characters */
  width?: number;
  height?: number;
  /** character cell height / width. ~2 in most terminals. */
  aspect?: number;
  /** a name from CHARSETS */
  charset?: string;
  /** a custom ramp, darkest first; overrides `charset` */
  chars?: string;
  /** resting tilt toward the viewer, radians. Positive shows the top. */
  pitch?: number;
  /**
   * the model is fitted so it stays inside the grid for any pitch up to this (radians, either way);
   * default: just the resting pitch. Viewers that let people tilt the model set it higher.
   */
  fitPitch?: number;
  /** auto-rotation speed around the vertical axis, radians per second (players use it, the renderer does not) */
  spin?: number;
  /** camera distance in model radii; smaller is more perspective */
  distance?: number;
  /** 1 fills the grid */
  zoom?: number;
  /** direction toward the light in view space: x right, y up, z toward the viewer */
  light?: Vec3;
  /** brightness floor, 0..1 */
  ambient?: number;
  /** auto: smooth if the model has normals, flat otherwise */
  shading?: 'auto' | 'flat' | 'smooth';
  /** samples per cell along each axis (2 = 4 samples). Higher is steadier and slower. */
  supersample?: number;
  /** share of a cell's samples that must hit the model for the cell to be drawn */
  coverage?: number;
  /**
   * draw lines with directional glyphs: `outline` around the silhouette, `depth` also where one part is
   * in front of another, `crease` also along folds of the surface (the edges of a cube or a gem's facets)
   */
  edges?: EdgeMode | boolean;
  /** four glyphs: horizontal, rising, vertical, falling */
  edgeChars?: string;
  /** depth jump (relative) that counts as an edge in `depth` and `crease` modes */
  edgeThreshold?: number;
  /** in `crease` mode, the angle in degrees between neighboring surfaces that counts as a fold (default 40) */
  creaseAngle?: number;
  /**
   * how far, as a share of one ramp step, a cell's brightness must move past a step before its glyph
   * changes from the one it had in the previous frame (0 to 1, default 0.5). Keeps glyphs from blinking
   * while a model turns; lines keep their direction and stay a little longer the same way. 0 makes every
   * frame independent of the one before.
   */
  steady?: number;
  color?: ColorInput;
  /**
   * how many distinct colors a gradient uses. Default: one per glyph of the ramp, so a color
   * changes only where the glyph does (far fewer color changes to draw). 0 = smooth.
   */
  colorSteps?: number;
  /** per material name */
  materials?: Record<string, MaterialInput>;
}

export interface Style {
  width: number;
  height: number;
  aspect: number;
  chars: string[];
  pitch: number;
  fitPitch: number;
  spin: number;
  distance: number;
  zoom: number;
  light: Vec3;
  ambient: number;
  shading: 'auto' | 'flat' | 'smooth';
  supersample: number;
  coverage: number;
  edges: EdgeMode;
  edgeChars: string[];
  edgeThreshold: number;
  creaseAngle: number;
  steady: number;
  color: ResolvedColor;
  /** 0 = smooth; otherwise the number of gradient colors (default: the ramp length) */
  colorSteps: number;
  materials: Record<string, MaterialInput>;
}

export const DEFAULTS = {
  width: 80,
  height: 40,
  aspect: 2,
  charset: 'classic',
  pitch: 0.3,
  spin: 0.66,
  distance: 5,
  zoom: 1,
  light: [-0.45, 0.6, 0.65] as Vec3,
  ambient: 0,
  shading: 'auto' as const,
  supersample: 2,
  coverage: 0.5,
  edgeChars: '-/|\\',
  edgeThreshold: 0.03,
  creaseAngle: 40,
  steady: 0.5,
};

/** Later inputs win; materials are merged by name. */
export function mergeStyles(...inputs: (StyleInput | undefined)[]): StyleInput {
  const out: StyleInput = {};
  for (const s of inputs) {
    if (!s) continue;
    const { materials, ...rest } = s;
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
    if (materials) out.materials = { ...out.materials, ...materials };
  }
  return out;
}

export function resolveRamp(chars: string | undefined, charset: string | undefined): string[] {
  if (chars !== undefined && chars.length) return [...chars];
  const name = charset ?? DEFAULTS.charset;
  const r = CHARSETS[name];
  if (!r) throw new Error(`unknown charset "${name}" (have: ${Object.keys(CHARSETS).join(', ')})`);
  return [...r];
}

export function resolveStyle(input: StyleInput = {}): Style {
  const num = (v: number | undefined, d: number, min = -Infinity, max = Infinity) => {
    const n = v ?? d;
    if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
    return Math.min(max, Math.max(min, n));
  };
  const l = input.light ?? DEFAULTS.light;
  const ll = Math.hypot(l[0], l[1], l[2]) || 1;
  const edgeChars = [...(input.edgeChars ?? DEFAULTS.edgeChars)];
  if (edgeChars.length !== 4) throw new Error('edgeChars needs exactly 4 glyphs: horizontal, rising, vertical, falling');
  return {
    width: Math.round(num(input.width, DEFAULTS.width, 1, 2000)),
    height: Math.round(num(input.height, DEFAULTS.height, 1, 2000)),
    aspect: num(input.aspect, DEFAULTS.aspect, 0.25, 8),
    chars: resolveRamp(input.chars, input.charset),
    pitch: num(input.pitch, DEFAULTS.pitch),
    fitPitch: Math.abs(num(input.fitPitch, 0, 0, Math.PI / 2)),
    spin: num(input.spin, DEFAULTS.spin),
    distance: num(input.distance, DEFAULTS.distance, 1.5, 1000),
    zoom: num(input.zoom, DEFAULTS.zoom, 0.01, 100),
    light: [l[0] / ll, l[1] / ll, l[2] / ll],
    ambient: num(input.ambient, DEFAULTS.ambient, 0, 1),
    shading: input.shading ?? DEFAULTS.shading,
    supersample: Math.round(num(input.supersample, DEFAULTS.supersample, 1, 4)),
    coverage: num(input.coverage, DEFAULTS.coverage, 0, 1),
    edges: input.edges === true ? 'outline' : input.edges || false,
    edgeChars,
    edgeThreshold: num(input.edgeThreshold, DEFAULTS.edgeThreshold, 0),
    creaseAngle: num(input.creaseAngle, DEFAULTS.creaseAngle, 1, 179),
    steady: num(input.steady, DEFAULTS.steady, 0, 1),
    color: resolveColor(input.color),
    colorSteps: Math.round(num(input.colorSteps, -1, -1, 4096)),
    materials: input.materials ?? {},
  };
}

export function parseHex(hex: string): RGB {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex color: ${hex}`);
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function resolveColor(c: ColorInput | undefined): ResolvedColor {
  const white: RGB = [255, 255, 255];
  if (c === undefined || c === 'none') return { mode: 'none', fg: white, stops: [], bg: null };
  if (typeof c === 'string') return { mode: 'mono', fg: parseHex(c), stops: [], bg: null };
  if (Array.isArray(c)) {
    if (c.length === 1) return { mode: 'mono', fg: parseHex(c[0]), stops: [], bg: null };
    const stops = c.map(parseHex);
    return { mode: 'gradient', fg: stops[stops.length - 1], stops, bg: null };
  }
  const stops = (c.stops ?? []).map(parseHex);
  const mode = c.mode ?? (stops.length > 1 ? 'gradient' : c.fg ? 'mono' : 'none');
  return { mode, fg: c.fg ? parseHex(c.fg) : stops[stops.length - 1] ?? white, stops, bg: c.bg ? parseHex(c.bg) : null };
}

export function resolveMaterial(name: string, input: MaterialInput | undefined): ResolvedMaterial {
  const m: ResolvedMaterial = { name, chars: null, color: null, opacity: 1, carved: false };
  if (input === undefined || input === 'solid') return m;
  if (input === 'carved') return { ...m, carved: true };
  if (input === 'dim') return { ...m, opacity: 0.6 };
  if (input.chars !== undefined || input.charset !== undefined) m.chars = resolveRamp(input.chars, input.charset);
  if (input.color) m.color = parseHex(input.color);
  if (input.opacity !== undefined) m.opacity = Math.min(1, Math.max(0, input.opacity));
  m.carved = !!input.carved;
  return m;
}
