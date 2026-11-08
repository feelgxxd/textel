import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGLTF, parseModel, parseOBJ, parseSTL } from '../src/loaders/index.ts';

const CUBE_OBJ = `
# unit cube, quads
v -1 -1 -1
v  1 -1 -1
v  1  1 -1
v -1  1 -1
v -1 -1  1
v  1 -1  1
v  1  1  1
v -1  1  1
usemtl red
f 1 2 3 4
f 5 8 7 6
usemtl blue
f 1 5 6 2
f 4 3 7 8
f -8 -4 -1 -5
f 2 6 7 3
`;

test('obj: quads are triangulated, materials kept, negative indices work', () => {
  const m = parseOBJ(CUBE_OBJ);
  assert.equal(m.indices.length / 3, 12);
  assert.deepEqual(m.materials, ['red', 'blue']);
  assert.equal(m.triMaterial[0], 0);
  assert.equal(m.triMaterial[11], 1);
  assert.equal(m.normals, null);
});

test('obj: v//vn faces keep normals', () => {
  const m = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1\n');
  assert.ok(m.normals);
  assert.deepEqual([...m.normals!.slice(0, 3)], [0, 0, 1]);
});

test('obj: bad index is a clear error', () => {
  assert.throws(() => parseOBJ('v 0 0 0\nf 1 2 3\n'), /bad vertex index/);
});

function binarySTL(tris: number[][]): Uint8Array {
  const buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((v, k) => dv.setFloat32(84 + i * 50 + 12 + k * 4, v, true)));
  return new Uint8Array(buf);
}

test('stl: binary and ascii', () => {
  const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const bin = parseSTL(binarySTL([tri, tri]));
  assert.equal(bin.indices.length, 6);
  assert.equal(bin.positions[3], 1);
  const ascii = parseSTL(new TextEncoder().encode('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n'));
  assert.equal(ascii.indices.length, 3);
});

/** a GLB with one triangle under a translated node, with normals and a named material */
function tinyGLB(): Uint8Array {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const nor = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const idx = new Uint16Array([0, 1, 2, 0]); // padded to 4 bytes
  const bin = new Uint8Array(pos.byteLength + nor.byteLength + idx.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(nor.buffer), 36);
  bin.set(new Uint8Array(idx.buffer), 72);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ translation: [10, 0, 0], children: [1] }, { mesh: 0, scale: [2, 2, 2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'Gold' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  js = new Uint8Array([...js, ...new Array(pad).fill(0x20)]);
  const total = 12 + 8 + js.length + 8 + bin.length;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
  const o = 20 + js.length;
  dv.setUint32(o, bin.length, true); dv.setUint32(o + 4, 0x004e4942, true); out.set(bin, o + 8);
  return out;
}

test('glb: node transforms, normals and material names', () => {
  const m = parseGLTF(tinyGLB());
  assert.equal(m.indices.length, 3);
  assert.deepEqual(m.materials, ['Gold']);
  // vertex 1 is (1,0,0) scaled by 2 then moved by 10
  assert.deepEqual([...m.positions.slice(3, 6)], [12, 0, 0]);
  assert.ok(m.normals);
  assert.ok(Math.abs(m.normals![2] - 1) < 1e-6);
});

test('glb: compressed files are rejected with a useful message', () => {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] }));
  assert.throws(() => parseGLTF(json), /not supported yet/);
});

test('parseModel picks the parser by extension or content', () => {
  assert.equal(parseModel(new TextEncoder().encode(CUBE_OBJ), 'cube.obj').indices.length, 36);
  assert.equal(parseModel(new TextEncoder().encode(CUBE_OBJ)).indices.length, 36);
  assert.equal(parseModel(tinyGLB(), 'x.bin').indices.length, 3);
});
