// Signed distance fields: build shapes in code and mesh them.
// Convention: negative inside, positive outside, roughly the distance to the surface.
import { MeshBuilder, type Mesh } from './mesh.ts';
import type { Vec3 } from './style.ts';

export type Field = (x: number, y: number, z: number) => number;

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const fract = (v: number) => v - Math.floor(v);

export const sdSphere = (x: number, y: number, z: number, r: number) => Math.hypot(x, y, z) - r;

/** axis-aligned box with half sizes hx hy hz, edges rounded by r */
export const sdBox = (x: number, y: number, z: number, hx: number, hy: number, hz: number, r = 0) => {
  const qx = Math.abs(x) - hx + r, qy = Math.abs(y) - hy + r, qz = Math.abs(z) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};

/** capped cylinder along y: radius r, half height h */
export const sdCyl = (x: number, y: number, z: number, r: number, h: number) => {
  const dx = Math.hypot(x, z) - r, dy = Math.abs(y) - h;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
};

/** torus in the xz plane: ring radius R, tube radius r */
export const sdTorus = (x: number, y: number, z: number, R: number, r: number) => Math.hypot(Math.hypot(x, z) - R, y) - r;

/** 2D polygon in the xy plane */
export const sdPoly = (v: number[][], px: number, py: number) => {
  let d = (px - v[0][0]) ** 2 + (py - v[0][1]) ** 2, s = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
    const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1], wx = px - v[i][0], wy = py - v[i][1];
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    d = Math.min(d, (wx - ex * t) ** 2 + (wy - ey * t) ** 2);
    const c1 = py >= v[i][1], c2 = py < v[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
};

/** a 2D distance pushed out along z to half thickness h, edges rounded by r */
export const extrude = (d2: number, z: number, h: number, r: number) => {
  const a = d2 + r, b = Math.abs(z) - h + r;
  return Math.min(Math.max(a, b), 0) + Math.hypot(Math.max(a, 0), Math.max(b, 0)) - r;
};

/** smooth union with blend radius k */
export const smin = (a: number, b: number, k: number) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
};

export interface SdfOptions {
  /** bounds of the sampling grid */
  min: Vec3;
  max: Vec3;
  /** grid spacing; the mesh has roughly one vertex per cell on the surface */
  step: number;
  /** material names, indexed by what `material` returns */
  materials?: string[];
  /** material index at a point on the surface */
  material?: (x: number, y: number, z: number) => number;
}

/** Meshes a field with surface nets. Synchronous; see sdfToMeshSteps to spread the work out. */
export function sdfToMesh(field: Field, opts: SdfOptions): Mesh {
  const g = sdfToMeshSteps(field, opts);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/**
 * The same as sdfToMesh, as a generator that yields after every grid layer, so a browser can
 * build a mesh in idle slices without blocking input.
 */
export function* sdfToMeshSteps(field: Field, opts: SdfOptions): Generator<void, Mesh> {
  const { step } = opts;
  if (!(step > 0)) throw new Error('step must be > 0');
  // one cell of padding so the surface is closed even if the bounds are tight
  const min = opts.min.map((v) => v - step), max = opts.max.map((v) => v + step);
  const NX = Math.ceil((max[0] - min[0]) / step) + 1, NY = Math.ceil((max[1] - min[1]) / step) + 1, NZ = Math.ceil((max[2] - min[2]) / step) + 1;
  if (NX * NY * NZ > 64e6) throw new Error('grid too fine: raise step or shrink the bounds');
  const val = new Float32Array(NX * NY * NZ);
  const at = (i: number, j: number, k: number) => (k * NY + j) * NX + i;
  for (let k = 0; k < NZ; k++) {
    const z = min[2] + k * step;
    for (let j = 0; j < NY; j++) {
      const y = min[1] + j * step;
      for (let i = 0; i < NX; i++) val[at(i, j, k)] = field(min[0] + i * step, y, z);
    }
    yield;
  }
  // the padding layer must be outside
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++)
    if (i === 0 || j === 0 || k === 0 || i === NX - 1 || j === NY - 1 || k === NZ - 1) val[at(i, j, k)] = Math.max(val[at(i, j, k)], 1e-6);

  const CX = NX - 1, CY = NY - 1;
  const cell = new Int32Array(CX * CY * (NZ - 1)).fill(-1);
  const cid = (i: number, j: number, k: number) => (k * CY + j) * CX + i;
  const b = new MeshBuilder();
  for (const name of opts.materials ?? ['default']) b.material(name);
  // the 12 cube edges as corner pairs; corner bits are x=1 y=2 z=4
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8);
  const h = step * 0.5;
  for (let k = 0; k < NZ - 1; k++) {
    for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        cv[c] = val[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
        if (cv[c] < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      // the vertex sits at the mean of the edge crossings
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, bb] of EDGES) {
        if ((cv[a] < 0) === (cv[bb] < 0)) continue;
        const t = cv[a] / (cv[a] - cv[bb]);
        sx += (a & 1) + t * ((bb & 1) - (a & 1));
        sy += ((a >> 1) & 1) + t * (((bb >> 1) & 1) - ((a >> 1) & 1));
        sz += ((a >> 2) & 1) + t * (((bb >> 2) & 1) - ((a >> 2) & 1));
        n++;
      }
      const x = min[0] + (i + sx / n) * step, y = min[1] + (j + sy / n) * step, z = min[2] + (k + sz / n) * step;
      // outward normal = gradient of the field
      const nx = field(x + h, y, z) - field(x - h, y, z), ny = field(x, y + h, z) - field(x, y - h, z), nz = field(x, y, z + h) - field(x, y, z - h);
      const l = Math.hypot(nx, ny, nz) || 1;
      cell[cid(i, j, k)] = b.vertex(x, y, z, nx / l, ny / l, nz / l);
    }
    yield;
  }

  const P = b.positions, mat = opts.material;
  const quad = (q0: number, q1: number, q2: number, q3: number, inside: boolean) => {
    const v = inside ? [q0, q1, q2, q3] : [q3, q2, q1, q0];
    let m = 0;
    if (mat) {
      let x = 0, y = 0, z = 0;
      for (const vi of v) { x += P[vi * 3]; y += P[vi * 3 + 1]; z += P[vi * 3 + 2]; }
      m = mat(x / 4, y / 4, z / 4) | 0;
    }
    b.triangle(v[0], v[1], v[2], m);
    b.triangle(v[0], v[2], v[3], m);
  };
  for (let k = 0; k < NZ; k++) {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const v0 = val[at(i, j, k)], in0 = v0 < 0;
      // each grid edge that crosses the surface becomes a quad joining the 4 cells around it
      if (i < NX - 1 && j > 0 && k > 0 && j < NY - 1 && k < NZ - 1 && in0 !== val[at(i + 1, j, k)] < 0)
        quad(cell[cid(i, j - 1, k - 1)], cell[cid(i, j, k - 1)], cell[cid(i, j, k)], cell[cid(i, j - 1, k)], in0);
      if (j < NY - 1 && i > 0 && k > 0 && i < NX - 1 && k < NZ - 1 && in0 !== val[at(i, j + 1, k)] < 0)
        quad(cell[cid(i - 1, j, k - 1)], cell[cid(i - 1, j, k)], cell[cid(i, j, k)], cell[cid(i, j, k - 1)], in0);
      if (k < NZ - 1 && i > 0 && j > 0 && i < NX - 1 && j < NY - 1 && in0 !== val[at(i, j, k + 1)] < 0)
        quad(cell[cid(i - 1, j - 1, k)], cell[cid(i, j - 1, k)], cell[cid(i, j, k)], cell[cid(i - 1, j, k)], in0);
    }
    yield;
  }
  return b.build();
}
