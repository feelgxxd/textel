import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellColor, createRenderer, toANSI, toHTML, toText } from '../src/index.ts';
import { parseOBJ } from '../src/loaders/obj.ts';
import { sdfToMesh, sdSphere, sdBox } from '../src/sdf.ts';

const sphere = sdfToMesh((x, y, z) => sdSphere(x, y, z, 1), { min: [-1, -1, -1], max: [1, 1, 1], step: 0.1 });

test('sdf: a sphere meshes into a closed surface with outward normals', () => {
  assert.ok(sphere.indices.length > 1000);
  assert.ok(sphere.normals);
  for (let v = 0; v < sphere.positions.length; v += 3) {
    const [x, y, z] = sphere.positions.slice(v, v + 3);
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 0.05, 'vertex on the surface');
    const [nx, ny, nz] = sphere.normals!.slice(v, v + 3);
    assert.ok(nx * x + ny * y + nz * z > 0.9, 'normal points out');
  }
});

test('render: the model fills the grid and stays inside it while spinning', () => {
  const r = createRenderer(sphere, { width: 40, height: 20, aspect: 2 });
  for (const yaw of [0, 1, 2, 3]) {
    const f = r.render({ yaw });
    const rows = toText(f).split('\n');
    assert.equal(rows.length, 20);
    assert.ok(rows.every((l) => l.length === 40));
    // border rows and columns stay empty, the middle is drawn
    assert.equal(rows[0].trim(), '');
    assert.equal(rows[19].trim(), '');
    assert.notEqual(rows[10][20], ' ');
    // a sphere at aspect 2 should come out about twice as wide as tall in cells
    const drawn = rows.filter((l) => l.trim());
    const width = Math.max(...drawn.map((l) => l.trimEnd().length - (l.length - l.trimStart().length)));
    assert.ok(Math.abs(width / drawn.length - 2) < 0.35, `width ${width} height ${drawn.length}`);
  }
});

test('render: the lit side is brighter than the shadow side', () => {
  const r = createRenderer(sphere, { width: 40, height: 20, light: [-1, 0, 0.3], charset: 'hard' });
  const f = r.render();
  const ramp = f.style.chars;
  const at = (c: number) => ramp.indexOf(f.chars[10 * 40 + c]);
  assert.ok(at(12) > at(28), 'left is lit');
});

test('render: carved and dim materials', () => {
  const m = parseOBJ('v -1 -1 0\nv 1 -1 0\nv 1 1 0\nv -1 1 0\nusemtl hole\nf 1 2 3 4\n');
  const carved = createRenderer(m, { width: 20, height: 10, pitch: 0, materials: { hole: 'carved' } }).render();
  assert.ok(carved.chars.every((c) => c === ' '));
  assert.ok([...carved.mat].some((x) => x === 0), 'still occupies the cells');
  const dim = createRenderer(m, { width: 20, height: 10, pitch: 0, materials: { hole: 'dim' } }).render();
  assert.match(toHTML(dim), /opacity:0\.6/);
  assert.match(toANSI(dim, 'truecolor').join(''), /\x1b\[2m/);
});

test('render: colors and edges', () => {
  const box = sdfToMesh((x, y, z) => sdBox(x, y, z, 1, 1, 1), { min: [-1, -1, -1], max: [1, 1, 1], step: 0.1 });
  const r = createRenderer(box, { width: 40, height: 20, color: ['#000000', '#ff0000'], edges: true });
  const f = r.render({ yaw: 0.6 });
  assert.match(toANSI(f, 'truecolor').join(''), /\x1b\[38;2;\d+;0;0m/);
  assert.match(toANSI(f, '256').join(''), /\x1b\[38;5;\d+m/);
  assert.match(toHTML(f), /color:#[0-9a-f]{2}0000/);
  const text = toText(f);
  assert.ok(/[|/\\-]/.test(text), 'edge glyphs');
});

test('render: setStyle resizes', () => {
  const r = createRenderer(sphere, { width: 10, height: 5 });
  r.setStyle({ width: 30, height: 12 });
  const f = r.render();
  assert.equal(f.chars.length, 360);
});

test('style errors are explicit', () => {
  assert.throws(() => createRenderer(sphere, { charset: 'nope' }), /unknown charset/);
  assert.throws(() => createRenderer(sphere, { color: 'red' }), /not a hex color/);
});

test('gradients use one color per glyph level by default, fewer color changes to draw', () => {
  const spans = (colorSteps?: number) => {
    const r = createRenderer(sphere, { width: 60, height: 24, color: ['#000000', '#ff0000'], charset: 'hard', colorSteps });
    return toHTML(r.render()).split('<span').length - 1;
  };
  const perGlyph = spans(), smooth = spans(0), single = spans(1);
  assert.ok(perGlyph * 2 < smooth, `per glyph ${perGlyph} vs smooth ${smooth}`);
  // with a single step every drawn run is one color: at most one span per row
  assert.ok(single <= 24, `single step ${single}`);
  // each glyph level maps to exactly one color
  const r = createRenderer(sphere, { width: 60, height: 24, color: ['#000000', '#ff0000'], charset: 'hard' });
  const f = r.render(), seen = new Map<string, string>();
  for (let i = 0; i < f.chars.length; i++) {
    if (f.chars[i] === ' ') continue;
    const rgb = cellColor(f, i).rgb!.join(',');
    assert.equal(seen.get(f.chars[i]) ?? rgb, rgb, `glyph ${f.chars[i]} has one color`);
    seen.set(f.chars[i], rgb);
  }
});

const CUBE = 'v -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nv -1 1 1\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 4 3 7 8\nf 1 4 8 5\nf 2 6 7 3\n';
const EDGE_GLYPHS = /[-/|\\]/;

test('edges: a flat face seen at a slant is not a depth step', () => {
  // A cube is convex: nothing on it stands in front of anything else, so depth lines are the outline,
  // and the top face seen from just above, whose depth changes fast but evenly, stays shaded. (Where a
  // face meets one seen almost edge on, a few cells of the bend may read as a step; that is fine.)
  const look = { width: 60, height: 30, aspect: 2, charset: 'hard', pitch: 0.45 } as const;
  const lines = (s: string) => [...s].filter((ch) => EDGE_GLYPHS.test(ch)).length;
  for (const yaw of [0.2, 0.6, 1.1]) {
    const depth = lines(toText(createRenderer(parseOBJ(CUBE), { ...look, edges: 'depth' }).render({ yaw })));
    const outline = lines(toText(createRenderer(parseOBJ(CUBE), { ...look, edges: 'outline' }).render({ yaw })));
    // before steps were told from slopes, the top face filled with lines: about 200 cells more
    assert.ok(depth - outline <= 25, `yaw ${yaw}: ${depth - outline} cells more than the outline`);
  }
});

test('edges: crease draws the folds of a cube one cell wide, and none on a sphere', () => {
  // a corner of the cube faces the camera: the vertical fold runs down the middle
  const r = createRenderer(parseOBJ(CUBE), { width: 60, height: 30, aspect: 2, charset: 'hard', edges: 'crease', pitch: 0.3 });
  const rows = toText(r.render({ yaw: Math.PI / 4 })).split('\n');
  const mid = rows.slice(14, 22);
  for (const row of mid) {
    const bars = [...row.matchAll(/\|/g)].map((m) => m.index!).filter((x) => x > 20 && x < 40);
    assert.equal(bars.length, 1, `one fold line in the middle: "${row}"`);
  }
  const plain = createRenderer(sphere, { width: 60, height: 30, aspect: 2, charset: 'hard', edges: 'outline' });
  const folded = createRenderer(sphere, { width: 60, height: 30, aspect: 2, charset: 'hard', edges: 'crease' });
  assert.equal(toText(folded.render({ yaw: 0.4 })), toText(plain.render({ yaw: 0.4 })), 'a smooth sphere has no folds');
});
