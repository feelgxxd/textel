import { MeshBuilder, type Mesh } from '../mesh.ts';

/** Wavefront OBJ: v, vn, f (any polygon, fan-triangulated), usemtl. Texture coordinates are ignored. */
export function parseOBJ(text: string): Mesh {
  const v: number[] = [], vn: number[] = [];
  const b = new MeshBuilder();
  const seen = new Map<string, number>();
  let mat = -1;
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/), tag = parts[0];
    if (tag === 'v') v.push(+parts[1], +parts[2], +parts[3]);
    else if (tag === 'vn') vn.push(+parts[1], +parts[2], +parts[3]);
    else if (tag === 'usemtl') { mat = b.material(parts.slice(1).join(' ') || 'default'); seen.clear(); }
    else if (tag === 'f') {
      if (mat < 0) mat = b.material('default');
      const poly: number[] = [];
      for (let p = 1; p < parts.length; p++) {
        const key = parts[p];
        let idx = seen.get(key);
        if (idx === undefined) {
          const [vs, , ns] = key.split('/');
          let vi = parseInt(vs, 10);
          vi = vi < 0 ? v.length / 3 + vi : vi - 1;
          if (!(vi >= 0 && vi < v.length / 3)) throw new Error(`obj line ${ln + 1}: bad vertex index "${key}"`);
          if (ns) {
            let ni = parseInt(ns, 10);
            ni = ni < 0 ? vn.length / 3 + ni : ni - 1;
            idx = b.vertex(v[vi * 3], v[vi * 3 + 1], v[vi * 3 + 2], vn[ni * 3], vn[ni * 3 + 1], vn[ni * 3 + 2]);
          } else {
            idx = b.vertex(v[vi * 3], v[vi * 3 + 1], v[vi * 3 + 2]);
          }
          seen.set(key, idx);
        }
        poly.push(idx);
      }
      for (let k = 1; k + 1 < poly.length; k++) b.triangle(poly[0], poly[k], poly[k + 1], mat);
    }
  }
  return b.build();
}
