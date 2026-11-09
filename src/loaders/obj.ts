import { MeshBuilder, type Mesh } from '../mesh.ts';

/** Options of parseOBJ. */
export interface ObjOptions {
  /** loads a material library (`mtllib`) by its name; without it, or when it throws, materials have no color */
  resolve?: (uri: string) => Uint8Array;
}

/**
 * Wavefront OBJ: v (with optional r g b), vn, f (any polygon, fan-triangulated), usemtl, and the diffuse
 * colors (`Kd`) of a `mtllib` when `resolve` can load it. Texture coordinates are ignored.
 */
export function parseOBJ(text: string, opts: ObjOptions = {}): Mesh {
  const g = parseOBJSteps(text, opts);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

/**
 * The same parser as a generator that yields every `slice` lines, so a page can parse a large file
 * in small pieces and stay responsive (see parseModelAsync).
 */
export function* parseOBJSteps(text: string, opts: ObjOptions = {}, slice = 4000): Generator<void, Mesh> {
  const v: number[] = [], vn: number[] = [], vc: number[] = [];
  const kd = new Map<string, [number, number, number]>();
  const b = new MeshBuilder();
  const seen = new Map<string, number>();
  let mat = -1;
  // walk the text line by line instead of splitting it, so a big file is not copied into one huge array
  for (let start = 0, ln = 0; start < text.length; ln++) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (ln % slice === slice - 1) yield;
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/), tag = parts[0];
    if (tag === 'v') {
      v.push(+parts[1], +parts[2], +parts[3]);
      if (parts.length >= 7) {
        // some tools write 0..255 instead of 0..1
        const rgb = [+parts[4], +parts[5], +parts[6]], k = rgb.some((x) => x > 1) ? 1 / 255 : 1;
        while (vc.length < v.length - 3) vc.push(1);
        vc.push(...rgb.map((x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x * k)) : 1)));
      }
    }
    else if (tag === 'mtllib' && opts.resolve) { if (readMTL(parts.slice(1).join(' '), opts.resolve, kd)) b.textured = true; }
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
          if (vi * 3 + 2 < vc.length) b.vertexColor(idx, vc[vi * 3], vc[vi * 3 + 1], vc[vi * 3 + 2]);
          seen.set(key, idx);
        }
        poly.push(idx);
      }
      for (let k = 1; k + 1 < poly.length; k++) b.triangle(poly[0], poly[k], poly[k + 1], mat);
    }
  }
  b.materials.forEach((name, i) => b.materialColor(i, kd.get(name) ?? null));
  return b.build();
}

/**
 * The diffuse color of each material in a .mtl file; a library that cannot be read is skipped.
 * Returns whether a material has a diffuse texture (`map_Kd`).
 */
function readMTL(uri: string, resolve: (uri: string) => Uint8Array, out: Map<string, [number, number, number]>): boolean {
  let text: string;
  try { text = new TextDecoder().decode(resolve(uri)); } catch { return false; }
  let name = '', textured = false;
  for (const raw of text.split('\n')) {
    const parts = raw.trim().split(/\s+/);
    if (parts[0] === 'newmtl') name = parts.slice(1).join(' ');
    else if (parts[0] === 'map_Kd') textured = true;
    else if (parts[0] === 'Kd' && name) {
      const rgb = [+parts[1], +parts[2], +parts[3]];
      if (rgb.every(Number.isFinite)) out.set(name, rgb.map((x) => Math.min(1, Math.max(0, x))) as [number, number, number]);
    }
  }
  return textured;
}
