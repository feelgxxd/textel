// Built-in example scenes, written as signed distance fields.
// Each one also shows off a feature: materials, flat faces, thin parts, depth.
import type { Mesh } from './mesh.ts';
import { clamp, extrude, sdBox, sdCyl, sdfToMeshSteps, sdSphere, sdTorus } from './sdf.ts';
import type { StyleInput, Vec3 } from './style.ts';

export interface Example {
  name: string;
  title: string;
  description: string;
  /** look that suits the scene; user options are merged on top */
  style: StyleInput;
  build: () => Generator<void, Mesh>;
}

const HARD_LIGHT: Vec3 = [-0.3, 0.35, 0.88];
const SOFT_LIGHT: Vec3 = [-0.45, 0.6, 0.65];
// material indices shared by the examples
const BODY = 0, CARVED = 1, DIM = 2;
const MATERIALS = ['body', 'carved', 'dim'];
const LOOK = { materials: { carved: 'carved', dim: 'dim' } } satisfies StyleInput;
// colors for `--color model`, rgb 0..1
type RGB = readonly [number, number, number];
const rgb = (hex: string): RGB => [0, 2, 4].map((k) => parseInt(hex.slice(1 + k, 3 + k), 16) / 255) as unknown as RGB;
const RED = rgb('#d8473c'), WHITE = rgb('#ecebe6'), CREAM = rgb('#f1e6cf');
const hard = (pitch: number): StyleInput => ({ ...LOOK, charset: 'hard', light: HARD_LIGHT, pitch });
const soft = (pitch: number): StyleInput => ({ ...LOOK, charset: 'classic', light: SOFT_LIGHT, pitch });

// ---------- donut: the classic ----------
function* donut() {
  // a torus is symmetric around its own axis, so spinning it flat would look still: the ring is
  // tilted 60° off the spin axis, and the turntable makes it tumble like donut.c
  const t = Math.PI / 3, c = Math.cos(t), s = Math.sin(t);
  const icing = rgb('#e8739e'), dough = rgb('#d79a5a');
  return yield* sdfToMeshSteps((x, y, z) => sdTorus(x, y * c - z * s, y * s + z * c, 1, 0.45), {
    min: [-1.5, -1.5, -1.5], max: [1.5, 1.5, 1.5], step: 0.03,
    // icing on the top half, with a wavy rim
    color: (x, y, z) => (y * c - z * s > 0.08 * Math.sin(Math.atan2(y * s + z * c, x) * 9) ? icing : dough),
  });
}

// ---------- dice: carved pips ----------
function* dice() {
  const s = 1, pip = 0.17, off = 0.5;
  // pip positions on a face, in face coordinates (u, v), for 1..6
  const FACES: number[][][] = [
    [[0, 0]],
    [[-off, -off], [off, off]],
    [[-off, -off], [0, 0], [off, off]],
    [[-off, -off], [-off, off], [off, -off], [off, off]],
    [[-off, -off], [-off, off], [0, 0], [off, -off], [off, off]],
    [[-off, -off], [-off, 0], [-off, off], [off, -off], [off, 0], [off, off]],
  ];
  // face n: axis, sign, and which coordinates span it; opposite faces add up to 7
  const SIDES: [number, number, number, number][] = [[2, 1, 0, 1], [0, 1, 2, 1], [1, 1, 0, 2], [1, -1, 0, 2], [0, -1, 2, 1], [2, -1, 0, 1]];
  const pipAt = (p: number[]) => {
    for (let f = 0; f < 6; f++) {
      const [ax, sg, u, v] = SIDES[f];
      if (p[ax] * sg < s - 0.25) continue;
      for (const [pu, pv] of FACES[f]) if (Math.hypot(p[u] - pu, p[v] - pv) < pip) return true;
    }
    return false;
  };
  // pips are shallow dimples pressed into each face: spheres of radius r centered just outside it
  const r = pip + 0.06, centers: number[][] = [];
  for (let f = 0; f < 6; f++) {
    const [ax, sg, u, v] = SIDES[f];
    const list: number[] = [];
    for (const [pu, pv] of FACES[f]) {
      const c = [0, 0, 0];
      c[ax] = sg * (s + 0.05); c[u] = pu; c[v] = pv;
      list.push(...c);
    }
    centers.push(list);
  }
  const field = (x: number, y: number, z: number) => {
    let d = sdBox(x, y, z, s, s, s, 0.18);
    const p = [x, y, z];
    for (let f = 0; f < 6; f++) {
      const [ax, sg] = SIDES[f];
      // a dimple only shapes the surface near its own face; farther in, the box is deeper anyway
      if (p[ax] * sg < s - 0.3) continue;
      const c = centers[f];
      for (let i = 0; i < c.length; i += 3) {
        const dx = x - c[i], dy = y - c[i + 1], dz = z - c[i + 2];
        d = Math.max(d, r - Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
    }
    return d;
  };
  return yield* sdfToMeshSteps(field, {
    min: [-1.1, -1.1, -1.1], max: [1.1, 1.1, 1.1], step: 0.025, materials: MATERIALS,
    material: (x, y, z) => (pipAt([x, y, z]) ? CARVED : BODY),
    color: () => RED,
  });
}

// ---------- rocket: thin fins, a dim window band ----------
function* rocket() {
  const body = (x: number, y: number, z: number) => {
    const r = Math.hypot(x, z);
    // ogive nose above y = 0.6, straight tube below
    const radius = y > 0.6 ? 0.42 * Math.sqrt(Math.max(0, 1 - ((y - 0.6) / 1.1) ** 2)) : 0.42;
    return Math.max(r - radius, Math.abs(y + 0.15) - 1.85 + (y > 0 ? 0.1 : 0)) * 0.9;
  };
  // three fins around the base
  const fins = (x: number, y: number, z: number) => {
    let d = 1e9;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const u = x * c + z * s, w = -x * s + z * c;
      const profile = Math.max(-u + 0.3, u - 0.95 + (y + 1.6) * 0.45, -(y + 1.9), y + 0.9 - (0.95 - u) * 0.3);
      d = Math.min(d, extrude(profile, w, 0.035, 0.01));
    }
    return d;
  };
  const nozzle = (x: number, y: number, z: number) => Math.max(sdCyl(x, y + 1.95, z, 0.3 + clamp(-(y + 1.85), 0, 0.2) * 0.6, 0.12), -(Math.hypot(x, z) - 0.2));
  const field = (x: number, y: number, z: number) => Math.min(body(x, y, z), fins(x, y, z), nozzle(x, y, z));
  return yield* sdfToMeshSteps(field, {
    min: [-1.05, -2.1, -1.05], max: [1.05, 1.75, 1.05], step: 0.025, materials: MATERIALS,
    material: (x, y, z) => {
      if (fins(x, y, z) < body(x, y, z) || nozzle(x, y, z) < body(x, y, z)) return DIM;
      // a porthole facing the viewer and a band below it
      if (z > 0 && Math.hypot(x, y - 0.25) < 0.16) return CARVED;
      if (Math.abs(y + 0.55) < 0.06) return DIM;
      return BODY;
    },
    color: (x, y, z) => (fins(x, y, z) < body(x, y, z) || y > 1.25 || Math.abs(y + 0.55) < 0.06 ? RED : nozzle(x, y, z) < body(x, y, z) ? rgb('#8a8f99') : WHITE),
  });
}

// ---------- planet: a tilted ring ----------
function* planet() {
  const t = 0.4, ct = Math.cos(t), st = Math.sin(t);
  const ring = (x: number, y: number, z: number) => {
    // ring plane tilted around z
    const ry = x * st + y * ct, rx = x * ct - y * st;
    const r = Math.hypot(rx, z);
    return extrude(Math.abs(r - 1.6) - 0.35, ry, 0.025, 0.01);
  };
  const globe = (x: number, y: number, z: number) => sdSphere(x, y, z, 1);
  return yield* sdfToMeshSteps((x, y, z) => Math.min(globe(x, y, z), ring(x, y, z)), {
    min: [-2.05, -1.2, -2.05], max: [2.05, 1.2, 2.05], step: 0.03, materials: MATERIALS,
    material: (x, y, z) => (ring(x, y, z) < globe(x, y, z) ? (Math.abs(Math.hypot(x * ct - y * st, z) - 1.6) < 0.06 ? CARVED : DIM) : BODY),
    // bands by latitude on the globe
    color: (x, y, z) => (ring(x, y, z) < globe(x, y, z) ? rgb('#cdb98f') : Math.sin(y * 9 + Math.sin(Math.atan2(z, x) * 3) * 0.4) > 0.2 ? rgb('#e0a96d') : CREAM),
  });
}

// ---------- mug: a hollow inside and a handle ----------
function* mug() {
  const cup = (x: number, y: number, z: number) => {
    const outer = sdCyl(x, y, z, 0.8, 0.9) - 0.04;
    const inner = sdCyl(x, y - 0.15, z, 0.68, 0.9);
    return Math.max(outer, -inner);
  };
  // the handle is a torus standing up on the side
  const handle = (x: number, y: number, z: number) => Math.max(Math.hypot(Math.hypot(x - 0.85, y) - 0.45, z) - 0.09, 0.78 - x);
  return yield* sdfToMeshSteps((x, y, z) => Math.min(cup(x, y, z), handle(x, y, z)), {
    min: [-0.9, -1, -0.9], max: [1.45, 1, 0.9], step: 0.022, materials: MATERIALS,
    // the inside reads darker
    material: (x, y, z) => (Math.hypot(x, z) < 0.71 && y > -0.7 ? DIM : BODY),
    color: (x, y, z) => (Math.hypot(x, z) < 0.71 && y > -0.7 ? WHITE : rgb('#3f7fcf')),
  });
}

// ---------- gem: flat facets ----------
function* gem() {
  // a brilliant-ish cut: crown and pavilion made of planes
  const N = 8;
  const field = (x: number, y: number, z: number) => {
    // snap to the nearest facet direction so every face is a plane
    const k = Math.round((Math.atan2(z, x) / (Math.PI * 2)) * N), fa = (k / N) * Math.PI * 2;
    const u = x * Math.cos(fa) + z * Math.sin(fa);
    const girdle = u - 1;
    const crown = u * 0.55 + y - 0.75;
    const table = y - 0.42;
    const pavilion = u * 0.75 - y * 0.66 - 0.75;
    return Math.max(girdle, crown, table, pavilion);
  };
  return yield* sdfToMeshSteps(field, { min: [-1.1, -1.2, -1.1], max: [1.1, 0.5, 1.1], step: 0.02, color: () => rgb('#53c1f0') });
}

export const EXAMPLES: Example[] = [
  { name: 'donut', title: 'DONUT', description: 'the classic torus', style: { charset: 'classic', pitch: 0.2 }, build: donut },
  { name: 'dice', title: 'DICE', description: 'a die with carved pips', style: hard(0.45), build: dice },
  { name: 'rocket', title: 'ROCKET', description: 'thin fins and a porthole', style: soft(0.15), build: rocket },
  { name: 'planet', title: 'PLANET', description: 'a globe with a tilted ring', style: soft(0.25), build: planet },
  { name: 'mug', title: 'MUG', description: 'a hollow cup with a handle', style: soft(0.5), build: mug },
  { name: 'gem', title: 'GEM', description: 'flat facets, good with --shading flat', style: { ...hard(0.35), edges: 'depth', ambient: 0.12 }, build: gem },
];

export function findExample(name: string): Example | undefined {
  const n = name.toLowerCase();
  return EXAMPLES.find((e) => e.name === n || e.title.toLowerCase() === n);
}

export function buildExample(e: Example): Mesh {
  const g = e.build();
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
