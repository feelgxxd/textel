import type { Mesh } from './mesh.ts';

/**
 * A lighter copy of a mesh with at most about `maxTriangles` triangles, for models far denser than
 * a character grid can show. Vertices that fall in the same cell of a 3D grid merge into their mean
 * (vertex clustering), and triangles that collapse go away; the grid is the finest one that fits the
 * budget. Materials and vertex colors are kept. Normals are dropped, so the renderer works them out
 * again with its crease angle and hard edges stay hard. A mesh already under the budget comes back as is.
 */
export function simplifyMesh(mesh: Mesh, maxTriangles: number): Mesh {
  const nT = mesh.indices.length / 3;
  if (!(nT > maxTriangles) || maxTriangles < 1) return mesh;
  const P = mesh.positions, nV = P.length / 3;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nV; v++) for (let a = 0; a < 3; a++) {
    const x = P[v * 3 + a];
    if (x < lo[a]) lo[a] = x;
    if (x > hi[a]) hi[a] = x;
  }
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  // a surface crossing a grid of g cells per side keeps roughly c·g² triangles: guess c, then correct it
  let g = Math.sqrt(maxTriangles / 4), best: Mesh | null = null, last = mesh;
  for (let pass = 0; pass < 5; pass++) {
    last = cluster(mesh, lo, size, g);
    const t = last.indices.length / 3;
    if (t <= maxTriangles && (!best || t > best.indices.length / 3)) best = last;
    if (t <= maxTriangles && t > maxTriangles * 0.8) break;
    g *= Math.sqrt((maxTriangles * 0.9) / Math.max(t, 1));
  }
  return best ?? last;
}

function cluster(mesh: Mesh, lo: number[], size: number, g: number): Mesh {
  const P = mesh.positions, C = mesh.colors ?? null, I = mesh.indices, nV = P.length / 3;
  const G = Math.max(1, Math.min(2048, Math.floor(g))), k = G / size;
  const cell = (v: number, a: number) => Math.min(G - 1, Math.floor((P[v * 3 + a] - lo[a]) * k));
  const ids = new Map<number, number>(), of = new Uint32Array(nV);
  const sum: number[] = [], col: number[] = [], count: number[] = [];
  for (let v = 0; v < nV; v++) {
    const key = cell(v, 0) + G * (cell(v, 1) + G * cell(v, 2));
    let id = ids.get(key);
    if (id === undefined) {
      id = count.length;
      ids.set(key, id);
      sum.push(0, 0, 0); count.push(0);
      if (C) col.push(0, 0, 0);
    }
    of[v] = id;
    count[id]++;
    for (let a = 0; a < 3; a++) {
      sum[id * 3 + a] += P[v * 3 + a];
      if (C) col[id * 3 + a] += C[v * 3 + a];
    }
  }
  // only clusters some triangle still uses become vertices
  const used = new Int32Array(count.length).fill(-1), indices: number[] = [], triMaterial: number[] = [];
  let n = 0;
  for (let t = 0; t < I.length / 3; t++) {
    const a = of[I[t * 3]], b = of[I[t * 3 + 1]], c = of[I[t * 3 + 2]];
    if (a === b || b === c || a === c) continue;
    for (const x of [a, b, c]) {
      if (used[x] < 0) used[x] = n++;
      indices.push(used[x]);
    }
    triMaterial.push(mesh.triMaterial[t]);
  }
  const positions = new Float32Array(n * 3), colors = C ? new Float32Array(n * 3) : null;
  for (let id = 0; id < count.length; id++) {
    const v = used[id];
    if (v < 0) continue;
    for (let a = 0; a < 3; a++) {
      positions[v * 3 + a] = sum[id * 3 + a] / count[id];
      if (colors) colors[v * 3 + a] = col[id * 3 + a] / count[id];
    }
  }
  return {
    positions, normals: null, indices: new Uint32Array(indices), triMaterial: new Uint16Array(triMaterial),
    materials: mesh.materials, colors, materialColors: mesh.materialColors, textured: mesh.textured,
  };
}
