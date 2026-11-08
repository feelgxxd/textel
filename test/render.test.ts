import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRenderer, toANSI, toHTML, toText } from '../src/index.ts';
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
