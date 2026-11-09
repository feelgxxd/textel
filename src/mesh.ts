/** An indexed triangle mesh. Every loader and the SDF mesher produce this. */
export interface Mesh {
  /** xyz per vertex */
  positions: Float32Array;
  /** xyz per vertex, unit length; null means "flat shade from the triangles" */
  normals: Float32Array | null;
  /** three vertex indices per triangle */
  indices: Uint32Array;
  /** material index per triangle, into `materials` */
  triMaterial: Uint16Array;
  /** material names; styles are looked up by these names */
  materials: string[];
  /** rgb per vertex, 0..1 in sRGB, from the file (glTF COLOR_0, OBJ `v x y z r g b`); drawn times the material's color */
  colors?: Float32Array | null;
  /** the file's own color of each material, rgb 0..1 in sRGB, or null where it has none */
  materialColors?: (readonly [number, number, number] | null)[];
  /** some material takes its color from an image texture, which textel does not read yet */
  textured?: boolean;
}

/** The number of vertices in a mesh. */
export const vertexCount = (m: Mesh) => m.positions.length / 3;
/** The number of triangles in a mesh. */
export const triangleCount = (m: Mesh) => m.indices.length / 3;

/** Collects triangles into a Mesh. Loaders push into it and call `build()` once. */
export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  indices: number[] = [];
  triMaterial: number[] = [];
  materials: string[] = [];
  /** false as soon as one vertex arrives without a normal */
  hasNormals = true;
  /** rgb per vertex, only once a vertex has a color (see vertexColor) */
  colors: number[] | null = null;
  materialColors: ([number, number, number] | null)[] = [];
  /** see Mesh.textured */
  textured = false;
  private matIndex = new Map<string, number>();

  material(name: string): number {
    let i = this.matIndex.get(name);
    if (i === undefined) {
      i = this.materials.length;
      this.materials.push(name);
      this.materialColors.push(null);
      this.matIndex.set(name, i);
    }
    return i;
  }

  vertex(x: number, y: number, z: number, nx?: number, ny?: number, nz?: number): number {
    const i = this.positions.length / 3;
    this.positions.push(x, y, z);
    if (nx === undefined || ny === undefined || nz === undefined) {
      this.hasNormals = false;
      this.normals.push(0, 0, 0);
    } else {
      this.normals.push(nx, ny, nz);
    }
    return i;
  }

  /** a color for vertex `i`, rgb 0..1 in sRGB; vertices without one are white */
  vertexColor(i: number, r: number, g: number, b: number) {
    const c = (this.colors ??= []);
    while (c.length < this.positions.length) c.push(1);
    c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
  }

  /** the file's color for a material, rgb 0..1 in sRGB */
  materialColor(material: number, rgb: [number, number, number] | null) {
    this.materialColors[material] = rgb;
  }

  triangle(a: number, b: number, c: number, material: number) {
    this.indices.push(a, b, c);
    this.triMaterial.push(material);
  }

  build(): Mesh {
    if (this.materials.length === 0) this.material('default');
    let colors: Float32Array | null = null;
    if (this.colors) {
      colors = new Float32Array(this.positions.length).fill(1);
      colors.set(this.colors.slice(0, colors.length));
    }
    return {
      positions: new Float32Array(this.positions),
      normals: this.hasNormals && this.positions.length ? normalizeAll(new Float32Array(this.normals)) : null,
      indices: new Uint32Array(this.indices),
      triMaterial: new Uint16Array(this.triMaterial),
      materials: this.materials,
      colors,
      materialColors: this.materialColors,
      textured: this.textured,
    };
  }
}

function normalizeAll(n: Float32Array): Float32Array {
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}


/** ids that are equal for vertices at the same position (quantized to 1e-5 of the model's size) */
function weld(P: Float32Array): { ids: Uint32Array; count: number } {
  const nV = P.length / 3, ids = new Uint32Array(nV);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < P.length; i++) { if (P[i] < lo) lo = P[i]; if (P[i] > hi) hi = P[i]; }
  const q = 1e5 / Math.max(hi - lo, 1e-9);
  // open addressing on the quantized position: slot -> first vertex with it, +1 (0 = empty)
  let size = 1;
  while (size < nV * 2) size <<= 1;
  const slots = new Int32Array(size), Q = new Int32Array(nV * 3);
  let count = 0;
  for (let v = 0; v < nV; v++) {
    const x = Math.round((P[v * 3] - lo) * q), y = Math.round((P[v * 3 + 1] - lo) * q), z = Math.round((P[v * 3 + 2] - lo) * q);
    Q[v * 3] = x; Q[v * 3 + 1] = y; Q[v * 3 + 2] = z;
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (size - 1);
    for (;;) {
      const s = slots[h];
      if (s === 0) { slots[h] = v + 1; ids[v] = count++; break; }
      const u = s - 1;
      if (Q[u * 3] === x && Q[u * 3 + 1] === y && Q[u * 3 + 2] === z) { ids[v] = ids[u]; break; }
      h = (h + 1) & (size - 1);
    }
  }
  return { ids, count };
}

/**
 * Normals for a mesh that has none, smooth across gentle bends and hard across folds sharper than
 * `angle` degrees. Each triangle corner gets the area-weighted mean of the faces around its vertex
 * that turn less than `angle` from its own face. Returns the distinct normals and, for every corner
 * (three per triangle, in index order), which normal it uses.
 */
export function creaseNormals(m: Mesh, angle: number): { normals: Float32Array; corners: Uint32Array } {
  const P = m.positions, I = m.indices, nT = I.length / 3;
  const { ids, count } = weld(P);
  // face normals: length is twice the area, which is the weight
  const fn = new Float64Array(nT * 3), fu = new Float64Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    fn[t * 3] = nx; fn[t * 3 + 1] = ny; fn[t * 3 + 2] = nz;
    if (l > 0) { fu[t * 3] = nx / l; fu[t * 3 + 1] = ny / l; fu[t * 3 + 2] = nz / l; }
  }
  // the faces around each welded vertex
  const start = new Uint32Array(count + 1);
  for (let i = 0; i < I.length; i++) start[ids[I[i]] + 1]++;
  for (let w = 0; w < count; w++) start[w + 1] += start[w];
  const fill = start.slice(0, count), around = new Uint32Array(I.length);
  for (let i = 0; i < I.length; i++) around[fill[ids[I[i]]]++] = (i / 3) | 0;

  const cos = Math.cos((Math.min(180, Math.max(0, angle)) * Math.PI) / 180) - 1e-9;
  const out: number[] = [], corners = new Uint32Array(I.length);
  // normals already made at each welded vertex, as a linked list, so corners that agree share one
  const head = new Int32Array(count).fill(-1), next: number[] = [];
  for (let i = 0; i < I.length; i++) {
    const t = (i / 3) | 0, w = ids[I[i]];
    let x = 0, y = 0, z = 0;
    for (let pass = 0; pass < 2 && x === 0 && y === 0 && z === 0; pass++) {
      for (let k = start[w]; k < start[w + 1]; k++) {
        const f = around[k];
        // the second pass, for a face with no area, takes every face around the vertex
        if (pass === 0 && fu[t * 3] * fu[f * 3] + fu[t * 3 + 1] * fu[f * 3 + 1] + fu[t * 3 + 2] * fu[f * 3 + 2] < cos) continue;
        x += fn[f * 3]; y += fn[f * 3 + 1]; z += fn[f * 3 + 2];
      }
    }
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    let found = -1;
    for (let j = head[w]; j >= 0; j = next[j]) {
      if (Math.abs(out[j * 3] - x) < 1e-5 && Math.abs(out[j * 3 + 1] - y) < 1e-5 && Math.abs(out[j * 3 + 2] - z) < 1e-5) { found = j; break; }
    }
    if (found < 0) {
      found = out.length / 3;
      out.push(x, y, z);
      next.push(head[w]);
      head[w] = found;
    }
    corners[i] = found;
  }
  return { normals: new Float32Array(out), corners };
}
