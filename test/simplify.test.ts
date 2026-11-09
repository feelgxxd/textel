import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeshBuilder } from '../src/mesh.ts';
import { createRenderer } from '../src/render.ts';
import { simplifyMesh } from '../src/simplify.ts';

/** a dense sphere, 2·N² triangles: red "top" material above the equator, blue "bottom" below */
function sphere(N: number) {
  const b = new MeshBuilder();
  b.material('top'); b.material('bottom');
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const th = (Math.PI * j) / N, ph = (2 * Math.PI * i) / N;
    const v = b.vertex(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    if (j <= N / 2) b.vertexColor(v, 1, 0, 0); else b.vertexColor(v, 0, 0, 1);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, m = j < N / 2 ? 0 : 1;
    b.triangle(a, a + 1, a + N + 2, m);
    b.triangle(a, a + N + 2, a + N + 1, m);
  }
  return b.build();
}

test('simplify: fits the budget, keeps the shape, materials and colors', () => {
  const m = sphere(300), s = simplifyMesh(m, 20_000);
  const t = s.indices.length / 3;
  assert.ok(t <= 20_000 && t > 10_000, `${t} triangles`);
  assert.equal(s.normals, null, 'normals are worked out again by the renderer');
  assert.deepEqual(s.materials, m.materials);
  assert.equal(s.triMaterial.length, t);
  // every vertex stays on the unit sphere, and colors stay red above and blue below
  for (let v = 0; v < s.positions.length / 3; v++) {
    const x = s.positions[v * 3], y = s.positions[v * 3 + 1], z = s.positions[v * 3 + 2];
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 0.02);
    if (y > 0.1) assert.deepEqual([...s.colors!.slice(v * 3, v * 3 + 3)], [1, 0, 0]);
  }
  for (let k = 0; k < t; k++) {
    const y = (s.positions[s.indices[k * 3] * 3 + 1] + s.positions[s.indices[k * 3 + 1] * 3 + 1] + s.positions[s.indices[k * 3 + 2] * 3 + 1]) / 3;
    if (Math.abs(y) > 0.05) assert.equal(s.triMaterial[k], y > 0 ? 0 : 1);
  }
  assert.equal(simplifyMesh(m, 1e9), m, 'under the budget it is the same mesh');
});

test('simplify: the renderer draws a dense model from a lighter copy that looks the same', () => {
  const m = sphere(300), look = { width: 60, height: 30, steady: 0 };
  const full = createRenderer({ ...m }, { ...look, maxTriangles: 0 }).render({ yaw: 0.5 });
  const r = createRenderer(m, { ...look, maxTriangles: 30_000 });
  assert.equal(r.mesh, m, 'the renderer still reports the mesh it was given');
  const light = r.render({ yaw: 0.5 });
  let lit = 0, differ = 0;
  for (let i = 0; i < full.chars.length; i++) {
    if (full.mat[i] < 0 && light.mat[i] < 0) continue;
    lit++;
    if (full.chars[i] !== light.chars[i]) differ++;
  }
  assert.ok(differ / lit < 0.08, `${differ} of ${lit} cells differ`);
});
