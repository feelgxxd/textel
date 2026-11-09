import { creaseNormals, type Mesh } from './mesh.ts';
import { simplifyMesh } from './simplify.ts';
import { mergeStyles, resolveMaterial, resolveStyle, type ResolvedMaterial, type Style, type StyleInput } from './style.ts';

export interface View {
  /** rotation around the vertical axis, radians */
  yaw?: number;
  /** tilt toward the viewer, radians; defaults to the style's pitch */
  pitch?: number;
  /** rotation around the view axis, radians */
  roll?: number;
}

/** One rendered frame. Output adapters (text, ANSI, HTML) only read this. */
export interface Frame {
  width: number;
  height: number;
  /** one glyph per cell, row-major */
  chars: string[];
  /** surface brightness per cell, 0..1 (0 for background) */
  lum: Float32Array;
  /** material index per cell, -1 for background */
  mat: Int16Array;
  /** with `color: 'model'`, the model's own color per cell: r, g, b, and 255 where it has one (else 0) */
  rgb: Uint8Array | null;
  materials: ResolvedMaterial[];
  style: Style;
}

export interface Renderer {
  readonly mesh: Mesh;
  readonly style: Style;
  /** merge into the current style input */
  setStyle(input: StyleInput): void;
  render(view?: View): Frame;
}

const BG = -1;

/**
 * A small software rasterizer that draws into a character grid.
 * The model is centered and scaled to a unit sphere; the camera sits on +z looking at the origin.
 * Each cell is sampled `supersample`² times; the cell takes the mean brightness of the samples that hit.
 */
export function createRenderer(source: Mesh, input: StyleInput = {}): Renderer {
  let styleInput: StyleInput = input;
  let style = resolveStyle(styleInput);
  // a model far denser than the grid can show is drawn from a lighter copy
  const mesh = simplifyMesh(source, style.maxTriangles);
  const nV = mesh.positions.length / 3, nT = mesh.indices.length / 3;
  if (!nT) throw new Error('the model has no triangles');
  const I = mesh.indices, TM = mesh.triMaterial;

  // ---- normalize to a unit sphere around the bounding box center ----
  const P = new Float32Array(nV * 3);
  {
    const src = mesh.positions;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < nV; v++) for (let a = 0; a < 3; a++) {
      const x = src[v * 3 + a];
      if (x < lo[a]) lo[a] = x;
      if (x > hi[a]) hi[a] = x;
    }
    const c = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
    let r = 0;
    for (let v = 0; v < nV; v++) r = Math.max(r, Math.hypot(src[v * 3] - c[0], src[v * 3 + 1] - c[1], src[v * 3 + 2] - c[2]));
    const k = 1 / (r || 1);
    for (let v = 0; v < nV; v++) for (let a = 0; a < 3; a++) P[v * 3 + a] = (src[v * 3 + a] - c[a]) * k;
  }
  // extents used to fit the model in the grid while it spins around y
  let rxz = 0, ry = 0;
  for (let v = 0; v < nV; v++) {
    rxz = Math.max(rxz, Math.hypot(P[v * 3], P[v * 3 + 2]));
    ry = Math.max(ry, Math.abs(P[v * 3 + 1]));
  }

  // normals and, per triangle corner, which one it uses; computed ones are kept for the angle they were made for
  let creased: { normals: Float32Array; corners: Uint32Array; angle: number } | null = null;
  const VP = new Float32Array(nV * 3); // view space positions
  const SX = new Float32Array(nV), SY = new Float32Array(nV), OZ = new Float32Array(nV);
  let VN: Float32Array | null = null;

  let materials: ResolvedMaterial[] = [];
  let sw = 0, sh = 0;
  let sOoz = new Float32Array(0), sLum = new Float32Array(0), sMat = new Int16Array(0);
  let cOoz = new Float32Array(0), cLum = new Float32Array(0), cMat = new Int16Array(0);
  // surface normals per sample and per cell (xyz), only kept for crease lines
  let sN = new Float32Array(0), cN = new Float32Array(0);
  // the previous frame's ramp step, material and edge direction per cell, for `steady`
  let pStep = new Int16Array(0), pMat = new Int16Array(0), pDir = new Int8Array(0);
  // the model's own colors per sample (rgb, alpha) and per cell, only kept for `color: 'model'`
  let sCol = new Float32Array(0), cCol = new Uint8Array(0);
  const VC = mesh.colors ?? null, MC = mesh.materials.map((_, i) => mesh.materialColors?.[i] ?? null);
  const colored = !!VC || MC.some((c) => c);

  function configure() {
    materials = mesh.materials.map((name) => resolveMaterial(name, style.materials[name]));
    const ss = style.supersample;
    if (sw !== style.width * ss || sh !== style.height * ss) {
      sw = style.width * ss; sh = style.height * ss;
      sOoz = new Float32Array(sw * sh); sLum = new Float32Array(sw * sh); sMat = new Int16Array(sw * sh);
    }
    const n = style.width * style.height;
    if (cOoz.length !== n) { cOoz = new Float32Array(n); cLum = new Float32Array(n); cMat = new Int16Array(n); }
    if (pStep.length !== n) { pStep = new Int16Array(n); pMat = new Int16Array(n).fill(BG); pDir = new Int8Array(n).fill(-1); }
    const creases = style.edges === 'crease';
    if (sN.length !== (creases ? sw * sh * 3 : 0)) sN = new Float32Array(creases ? sw * sh * 3 : 0);
    if (cN.length !== (creases ? n * 3 : 0)) cN = new Float32Array(creases ? n * 3 : 0);
    const own = style.color.mode === 'model' && colored;
    if (sCol.length !== (own ? sw * sh * 4 : 0)) sCol = new Float32Array(own ? sw * sh * 4 : 0);
    if (cCol.length !== (own ? n * 4 : 0)) cCol = new Uint8Array(own ? n * 4 : 0);
  }
  configure();

  /** the normals to shade with and which one each triangle corner uses, or null for flat shading */
  function normals(): { N: Float32Array; corner: Uint32Array } | null {
    if (style.shading === 'flat') return null;
    if (mesh.normals) return { N: mesh.normals, corner: I };
    // a model without normals: smooth, except across folds sharper than creaseAngle (or none at all)
    const angle = style.shading === 'smooth' ? 180 : style.creaseAngle;
    if (creased?.angle !== angle) creased = { ...creaseNormals(mesh, angle), angle };
    return { N: creased.normals, corner: creased.corners };
  }

  /** focal length in samples: the model fits the grid at any yaw, at the resting pitch */
  function focal(): number {
    const D = style.distance;
    // vertical half extent ry·cos p + rxz·sin p, at its largest over the pitches that must fit;
    // it peaks at p = atan(rxz / ry), so check that point when it is inside the range
    const lo = Math.abs(style.pitch), hi = Math.max(lo, style.fitPitch), peak = Math.atan2(rxz, ry);
    const extent = (p: number) => ry * Math.cos(p) + rxz * Math.sin(p);
    const hx = Math.max(rxz, 1e-3), hy = Math.max(peak > lo && peak < hi ? Math.hypot(ry, rxz) : Math.max(extent(lo), extent(hi)), 1e-3);
    // largest x/z a circle of radius r at distance D reaches, with perspective
    const tx = hx / Math.sqrt(D * D - Math.min(hx * hx, D * D * 0.99));
    const ty = hy / Math.sqrt(D * D - 1);
    return style.zoom * Math.min((sw / 2) / tx, ((sh / 2) * style.aspect) / ty) * 0.98;
  }

  function render(view: View = {}): Frame {
    const ss = style.supersample, W = style.width, H = style.height, D = style.distance, aspect = style.aspect;
    const yaw = view.yaw ?? 0, pitch = view.pitch ?? style.pitch, roll = view.roll ?? 0;
    // R = Rz(roll) * Rx(pitch) * Ry(yaw): spin on a turntable, then tilt toward the camera
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // Rx*Ry
    const a00 = cy, a01 = 0, a02 = sy;
    const a10 = sp * sy, a11 = cp, a12 = -sp * cy;
    const a20 = -cp * sy, a21 = sp, a22 = cp * cy;
    const m00 = cr * a00 - sr * a10, m01 = cr * a01 - sr * a11, m02 = cr * a02 - sr * a12;
    const m10 = sr * a00 + cr * a10, m11 = sr * a01 + cr * a11, m12 = sr * a02 + cr * a12;
    const m20 = a20, m21 = a21, m22 = a22;

    const f = focal(), fy = f / aspect, hw = sw / 2, hh = sh / 2;
    for (let v = 0, o = 0; v < nV; v++, o += 3) {
      const x = P[o], y = P[o + 1], z = P[o + 2];
      const X = m00 * x + m01 * y + m02 * z, Y = m10 * x + m11 * y + m12 * z, Z = m20 * x + m21 * y + m22 * z;
      VP[o] = X; VP[o + 1] = Y; VP[o + 2] = Z;
      const ooz = 1 / (D - Z);
      OZ[v] = ooz; SX[v] = hw + f * X * ooz; SY[v] = hh - fy * Y * ooz;
    }
    const shade = normals(), N = shade?.N, NI = shade?.corner ?? I;
    if (!N) VN = null;
    else {
      if (!VN || VN.length !== N.length) VN = new Float32Array(N.length);
      for (let o = 0; o < N.length; o += 3) {
        const x = N[o], y = N[o + 1], z = N[o + 2];
        VN[o] = m00 * x + m01 * y + m02 * z; VN[o + 1] = m10 * x + m11 * y + m12 * z; VN[o + 2] = m20 * x + m21 * y + m22 * z;
      }
    }

    sOoz.fill(0); sMat.fill(BG);
    const [lx, ly, lz] = style.light, amb = style.ambient, dif = 1 - amb;

    for (let t = 0; t < nT; t++) {
      const ia = I[t * 3], ib = I[t * 3 + 1], ic = I[t * 3 + 2];
      const ax = SX[ia], ay = SY[ia], bx = SX[ib], by = SY[ib], cx = SX[ic], cyy = SY[ic];
      const area = (bx - ax) * (cyy - ay) - (by - ay) * (cx - ax);
      if (area === 0 || !Number.isFinite(area)) continue;
      // sample centers sit at +0.5
      const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5)), x1 = Math.min(sw - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
      const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cyy) - 0.5)), y1 = Math.min(sh - 1, Math.floor(Math.max(ay, by, cyy) - 0.5));
      if (x0 > x1 || y0 > y1) continue;

      // geometric normal in view space, oriented toward the camera
      const pa = ia * 3, pb = ib * 3, pc = ic * 3, na = NI[t * 3] * 3, nb = NI[t * 3 + 1] * 3, nc = NI[t * 3 + 2] * 3;
      const e1x = VP[pb] - VP[pa], e1y = VP[pb + 1] - VP[pa + 1], e1z = VP[pb + 2] - VP[pa + 2];
      const e2x = VP[pc] - VP[pa], e2y = VP[pc + 1] - VP[pa + 1], e2z = VP[pc + 2] - VP[pa + 2];
      let fnx = e1y * e2z - e1z * e2y, fny = e1z * e2x - e1x * e2z, fnz = e1x * e2y - e1y * e2x;
      const gx = (VP[pa] + VP[pb] + VP[pc]) / 3, gy = (VP[pa + 1] + VP[pb + 1] + VP[pc + 1]) / 3, gz = (VP[pa + 2] + VP[pb + 2] + VP[pc + 2]) / 3;
      const vx = -gx, vy = -gy, vz = D - gz;
      let flip = 1, flatLum = 0, fx = 0, fy = 0, fz = 0;
      if (VN) {
        // trust the vertex normals for "outside"; flip them when we see the inside of a face
        const nsx = VN[na] + VN[nb] + VN[nc], nsy = VN[na + 1] + VN[nb + 1] + VN[nc + 1], nsz = VN[na + 2] + VN[nb + 2] + VN[nc + 2];
        if (fnx * nsx + fny * nsy + fnz * nsz < 0) { fnx = -fnx; fny = -fny; fnz = -fnz; }
        if (fnx * vx + fny * vy + fnz * vz < 0) flip = -1;
      } else {
        if (fnx * vx + fny * vy + fnz * vz < 0) { fnx = -fnx; fny = -fny; fnz = -fnz; }
        const l = Math.hypot(fnx, fny, fnz) || 1;
        fx = fnx / l; fy = fny / l; fz = fnz / l;
        flatLum = amb + dif * Math.max(0, fx * lx + fy * ly + fz * lz);
      }

      const inv = 1 / area, mat = TM[t], oa = OZ[ia], ob = OZ[ib], oc = OZ[ic], keepN = sN.length > 0;
      const keepC = sCol.length > 0, mc = MC[mat];
      // a material without a color of its own still shows the vertex colors, and nothing without those
      const kr = mc ? mc[0] : 1, kg = mc ? mc[1] : 1, kb = mc ? mc[2] : 1, ka = mc || VC ? 1 : 0;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w0 = ((bx - px) * (cyy - py) - (by - py) * (cx - px)) * inv;
          const w1 = ((cx - px) * (ay - py) - (cyy - py) * (ax - px)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
          const ooz = w0 * oa + w1 * ob + w2 * oc, i = y * sw + x;
          if (ooz <= sOoz[i]) continue;
          sOoz[i] = ooz;
          sMat[i] = mat;
          if (keepC) {
            const o = i * 4;
            if (VC) {
              sCol[o] = kr * (w0 * VC[pa] + w1 * VC[pb] + w2 * VC[pc]);
              sCol[o + 1] = kg * (w0 * VC[pa + 1] + w1 * VC[pb + 1] + w2 * VC[pc + 1]);
              sCol[o + 2] = kb * (w0 * VC[pa + 2] + w1 * VC[pb + 2] + w2 * VC[pc + 2]);
            } else { sCol[o] = kr; sCol[o + 1] = kg; sCol[o + 2] = kb; }
            sCol[o + 3] = ka;
          }
          if (VN) {
            const nx = (w0 * VN[na] + w1 * VN[nb] + w2 * VN[nc]) * flip;
            const ny = (w0 * VN[na + 1] + w1 * VN[nb + 1] + w2 * VN[nc + 1]) * flip;
            const nz = (w0 * VN[na + 2] + w1 * VN[nb + 2] + w2 * VN[nc + 2]) * flip;
            const l = Math.hypot(nx, ny, nz) || 1;
            sLum[i] = amb + dif * Math.max(0, (nx * lx + ny * ly + nz * lz) / l);
            if (keepN) { sN[i * 3] = nx / l; sN[i * 3 + 1] = ny / l; sN[i * 3 + 2] = nz / l; }
          } else {
            sLum[i] = flatLum;
            // flat shading: the face's own normal, toward the camera
            if (keepN) { sN[i * 3] = fx; sN[i * 3 + 1] = fy; sN[i * 3 + 2] = fz; }
          }
        }
      }
    }

    // ---- resolve samples into cells ----
    const n = ss * ss, need = Math.max(1, Math.ceil(style.coverage * n - 1e-9));
    const votes = new Int16Array(n);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      let hit = 0, lum = 0, ooz = 0, nx = 0, ny = 0, nz = 0, sr = 0, sg = 0, sb = 0, cn = 0;
      const keepN = cN.length > 0, keepC = cCol.length > 0;
      for (let sy2 = 0; sy2 < ss; sy2++) for (let sx2 = 0; sx2 < ss; sx2++) {
        const i = (r * ss + sy2) * sw + c * ss + sx2;
        if (sMat[i] === BG) continue;
        votes[hit++] = sMat[i];
        lum += sLum[i];
        if (sOoz[i] > ooz) ooz = sOoz[i];
        if (keepN) { nx += sN[i * 3]; ny += sN[i * 3 + 1]; nz += sN[i * 3 + 2]; }
        if (keepC && sCol[i * 4 + 3]) { sr += sCol[i * 4]; sg += sCol[i * 4 + 1]; sb += sCol[i * 4 + 2]; cn++; }
      }
      const ci = r * W + c;
      if (keepC) {
        const k = cn ? 255 / cn : 0;
        cCol[ci * 4] = sr * k; cCol[ci * 4 + 1] = sg * k; cCol[ci * 4 + 2] = sb * k; cCol[ci * 4 + 3] = cn ? 255 : 0;
      }
      if (hit < need) { cMat[ci] = BG; cLum[ci] = 0; cOoz[ci] = 0; continue; }
      cMat[ci] = hit === 1 ? votes[0] : majority(votes, hit);
      cLum[ci] = lum / hit;
      cOoz[ci] = ooz;
      if (keepN) {
        const l = Math.hypot(nx, ny, nz) || 1;
        cN[ci * 3] = nx / l; cN[ci * 3 + 1] = ny / l; cN[ci * 3 + 2] = nz / l;
      }
    }

    // ---- glyphs ----
    const chars: string[] = new Array(W * H), steady = style.steady;
    for (let i = 0; i < W * H; i++) {
      const m = cMat[i];
      if (m === BG) { chars[i] = ' '; continue; }
      const ms = materials[m];
      if (ms.carved) { chars[i] = ' '; continue; }
      const ramp = ms.chars ?? style.chars, x = cLum[i] * ramp.length, p = pStep[i];
      let k = Math.min(ramp.length - 1, Math.floor(x));
      // keep last frame's step until the brightness is clearly past it
      if (pMat[i] === m && p !== k && p < ramp.length && x > p - steady && x < p + 1 + steady) k = p;
      chars[i] = ramp[k];
      pStep[i] = k;
    }
    for (let i = 0; i < W * H; i++) pMat[i] = cMat[i];
    if (style.edges) drawEdges(chars, W, H);

    return { width: W, height: H, chars, lum: cLum.slice(), mat: cMat.slice(), rgb: cCol.length ? cCol.slice() : null, materials, style };
  }

  function drawEdges(chars: string[], W: number, H: number) {
    const crease = style.edges === 'crease', depth = style.edges === 'depth' || crease, th = style.edgeThreshold, aspect = style.aspect;
    const cosFold = Math.cos((style.creaseAngle * Math.PI) / 180);
    const solid = (c: number, r: number) => c >= 0 && r >= 0 && c < W && r < H && cMat[r * W + c] !== BG;
    const F = (c: number, r: number) => (solid(c, r) ? cOoz[r * W + c] : 0);
    // the angles '/' and '\' actually sit at in a cell this tall
    const diag = Math.atan(aspect), b1 = diag / 2, b2 = (diag + Math.PI / 2) / 2, b3 = Math.PI - b2, b4 = Math.PI - b1;
    const [hz, rise, vert, fall] = style.edgeChars;
    // how far past a boundary between two directions a line may turn before its glyph follows
    const slack = style.steady * 0.6, lo = [b4, b1, b2, b3], hi = [b1 + Math.PI, b2, b3, b4];
    const near = (a: number, d: number) => {
      const x = d === 0 && a < b2 ? a + Math.PI : a;
      return x > lo[d] - slack && x < hi[d] + slack;
    };
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (cMat[i] === BG || materials[cMat[i]].carved) { pDir[i] = -1; continue; }
      let edge = false, fold = false;
      // a cell that was a line last frame stays one a little longer
      const was = pDir[i] >= 0 ? 1 - style.steady / 2 : 1, step = th * was;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!solid(c + dc, r + dr)) { edge = true; break; }
        if (!depth) continue;
        // A step, not a slope: inverse depth runs straight across a flat face, so the neighbor is
        // predicted from the cell on the other side. Only the nearer side of a step gets the line.
        const expect = solid(c - dc, r - dr) ? 2 * cOoz[i] - cOoz[(r - dr) * W + c - dc] : cOoz[i];
        if (expect - F(c + dc, r + dr) > step * cOoz[i]) { edge = true; break; }
      }
      if (!edge && crease) {
        // a fold where the surface turns sharply, kept only where it turns most, so lines stay one cell wide
        const [s, ax] = bend(c, r, W, H), [dc, dr] = ax ? [0, 1] : [1, 0];
        fold = s > (1 - cosFold) * was && s >= bend(c - dc, r - dr, W, H)[0] && s > bend(c + dc, r + dr, W, H)[0];
      }
      if (!edge && !fold) { pDir[i] = -1; continue; }
      let gx = 0, gy = 0;
      if (edge) {
        // Sobel on inverse depth (background = 0); screen y points down
        gx = F(c + 1, r - 1) + 2 * F(c + 1, r) + F(c + 1, r + 1) - F(c - 1, r - 1) - 2 * F(c - 1, r) - F(c - 1, r + 1);
        const gyDown = F(c - 1, r + 1) + 2 * F(c, r + 1) + F(c + 1, r + 1) - F(c - 1, r - 1) - 2 * F(c, r - 1) - F(c + 1, r - 1);
        gy = -gyDown / aspect;
      } else {
        [gx, gy] = foldGradient(c, r, W, H, aspect);
      }
      if (gx === 0 && gy === 0) { pDir[i] = -1; continue; }
      // the line runs perpendicular to the gradient
      let a = Math.atan2(gx, -gy);
      if (a < 0) a += Math.PI;
      if (a >= Math.PI) a -= Math.PI;
      let dir = a < b1 || a >= b4 ? 0 : a < b2 ? 1 : a < b3 ? 2 : 3;
      // keep last frame's direction while the line is still close to it
      const q = pDir[i];
      if (q >= 0 && q !== dir && near(a, q)) dir = q;
      pDir[i] = dir;
      chars[i] = dir === 0 ? hz : dir === 1 ? rise : dir === 2 ? vert : fall;
    }
  }

  /**
   * How sharply the surface turns at a cell: 1 − cos of the angle between the normals on either side,
   * across the row (axis 0) or the column (axis 1), whichever is larger. Off-model cells count as flat.
   */
  function bend(c: number, r: number, W: number, H: number): [number, number] {
    if (c < 0 || r < 0 || c >= W || r >= H || cMat[r * W + c] === BG) return [0, 0];
    const i = r * W + c;
    const at = (cc: number, rr: number) => {
      const j = rr * W + cc;
      return cc < 0 || rr < 0 || cc >= W || rr >= H || cMat[j] === BG || materials[cMat[j]].carved ? i : j;
    };
    const turn = (a: number, b: number) => 1 - (cN[a * 3] * cN[b * 3] + cN[a * 3 + 1] * cN[b * 3 + 1] + cN[a * 3 + 2] * cN[b * 3 + 2]);
    const across = turn(at(c - 1, r), at(c + 1, r)), down = turn(at(c, r - 1), at(c, r + 1));
    return across >= down ? [across, 0] : [down, 1];
  }

  /**
   * Which way the surface turns across a fold: Sobel on each normal component, combined as a structure
   * tensor, whose main axis points across the fold. Returned as a gradient (x right, y up).
   */
  function foldGradient(c: number, r: number, W: number, H: number, aspect: number): [number, number] {
    const i = r * W + c;
    let jxx = 0, jxy = 0, jyy = 0;
    for (let k = 0; k < 3; k++) {
      // cells off the model read as this cell, so the silhouette does not count as a turn
      const n = (dc: number, dr: number) => {
        const cc = c + dc, rr = r + dr;
        return cc < 0 || rr < 0 || cc >= W || rr >= H || cMat[rr * W + cc] === BG ? cN[i * 3 + k] : cN[(rr * W + cc) * 3 + k];
      };
      const gx = n(1, -1) + 2 * n(1, 0) + n(1, 1) - n(-1, -1) - 2 * n(-1, 0) - n(-1, 1);
      const gy = -(n(-1, 1) + 2 * n(0, 1) + n(1, 1) - n(-1, -1) - 2 * n(0, -1) - n(1, -1)) / aspect;
      jxx += gx * gx; jxy += gx * gy; jyy += gy * gy;
    }
    const t = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
    return [Math.cos(t), Math.sin(t)];
  }

  return {
    mesh: source,
    get style() { return style; },
    setStyle(next: StyleInput) {
      styleInput = mergeStyles(styleInput, next);
      style = resolveStyle(styleInput);
      configure();
    },
    render,
  };
}

function majority(v: Int16Array, n: number): number {
  let best = v[0], bestN = 0;
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = 0; j < n; j++) if (v[j] === v[i]) k++;
    if (k > bestN) { bestN = k; best = v[i]; }
  }
  return best;
}
