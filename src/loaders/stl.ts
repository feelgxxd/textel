import type { Mesh } from '../mesh.ts';

/** STL, binary or ASCII. STL has no shared vertices or usable normals, so the mesh is flat shaded by default. */
export function parseSTL(bytes: Uint8Array): Mesh {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === bytes.length) {
      const pos = new Float32Array(n * 9);
      for (let t = 0; t < n; t++) {
        const o = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) pos[t * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return soup(pos);
    }
  }
  const text = new TextDecoder().decode(bytes);
  const nums: number[] = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) nums.push(+m[1], +m[2], +m[3]);
  if (!nums.length || nums.length % 9) throw new Error('not a valid STL file');
  return soup(new Float32Array(nums));
}

function soup(pos: Float32Array): Mesh {
  const n = pos.length / 3, idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  return { positions: pos, normals: null, indices: idx, triMaterial: new Uint16Array(n / 3), materials: ['default'] };
}
