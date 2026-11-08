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
}

export const vertexCount = (m: Mesh) => m.positions.length / 3;
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
  private matIndex = new Map<string, number>();

  material(name: string): number {
    let i = this.matIndex.get(name);
    if (i === undefined) {
      i = this.materials.length;
      this.materials.push(name);
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

  triangle(a: number, b: number, c: number, material: number) {
    this.indices.push(a, b, c);
    this.triMaterial.push(material);
  }

  build(): Mesh {
    if (this.materials.length === 0) this.material('default');
    return {
      positions: new Float32Array(this.positions),
      normals: this.hasNormals && this.positions.length ? normalizeAll(new Float32Array(this.normals)) : null,
      indices: new Uint32Array(this.indices),
      triMaterial: new Uint16Array(this.triMaterial),
      materials: this.materials,
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

/**
 * Smooth vertex normals for a mesh that has none. Vertices at the same position are welded first,
 * so a triangle soup (STL) still shades smoothly. Each face contributes its area-weighted normal.
 */
export function computeSmoothNormals(m: Mesh): Float32Array {
  const P = m.positions, I = m.indices, nV = P.length / 3;
  // weld by quantized position
  const ids = new Uint32Array(nV);
  const keys = new Map<string, number>();
  let b = [Infinity, -Infinity];
  for (let i = 0; i < P.length; i++) { b[0] = Math.min(b[0], P[i]); b[1] = Math.max(b[1], P[i]); }
  const q = 1e5 / Math.max(b[1] - b[0], 1e-9);
  for (let v = 0; v < nV; v++) {
    const k = `${Math.round(P[v * 3] * q)},${Math.round(P[v * 3 + 1] * q)},${Math.round(P[v * 3 + 2] * q)}`;
    let id = keys.get(k);
    if (id === undefined) { id = keys.size; keys.set(k, id); }
    ids[v] = id;
  }
  const acc = new Float64Array(keys.size * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, bb = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1x = P[bb] - P[a], e1y = P[bb + 1] - P[a + 1], e1z = P[bb + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    // cross product length is twice the area, which is the weight we want
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [I[t], I[t + 1], I[t + 2]]) {
      const w = ids[v] * 3;
      acc[w] += nx; acc[w + 1] += ny; acc[w + 2] += nz;
    }
  }
  const out = new Float32Array(nV * 3);
  for (let v = 0; v < nV; v++) {
    const w = ids[v] * 3;
    const l = Math.hypot(acc[w], acc[w + 1], acc[w + 2]) || 1;
    out[v * 3] = acc[w] / l; out[v * 3 + 1] = acc[w + 1] / l; out[v * 3 + 2] = acc[w + 2] / l;
  }
  return out;
}
