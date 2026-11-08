// The DOM-free logic of <textel-player>. The element itself is tried by hand on the demo page (npm run demo).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessibleLabel, advance, fit, frameMarkup, scrub } from '../src/browser/player-core.ts';
import { buildExample, EXAMPLES } from '../src/examples.ts';
import { fromFramesFile, recordingText, recordLoop, toFramesFile, type Recording } from '../src/frames.ts';
import { createRenderer } from '../src/render.ts';
import { mergeStyles } from '../src/style.ts';

const rocket = EXAMPLES.find((e) => e.name === 'rocket')!;
const mesh = buildExample(rocket);
const record = (extra = {}) =>
  fromFramesFile(toFramesFile(recordLoop(createRenderer(mesh, mergeStyles(rocket.style, { width: 48, height: 20 }, extra)), { frames: 6, meta: { title: 'ROCKET' } })));

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('player: frames without styles are plain text, identical to the terminal text', () => {
  const rec = record({ materials: {} });
  const plain: Recording = { ...rec, styles: null, frames: rec.frames.map((f) => ({ glyph: f.glyph, style: null })) };
  for (let i = 0; i < plain.frames.length; i++) {
    const m = frameMarkup(plain, i);
    assert.equal(m.html, false);
    assert.equal(m.content, recordingText(plain, i));
  }
});

test('player: styled frames become spans, and the text underneath is unchanged', () => {
  const dim = record();
  const m = frameMarkup(dim, 2);
  assert.equal(m.html, true);
  assert.match(m.content, /<span class="d">/, 'dim material');
  assert.equal(stripTags(m.content), recordingText(dim, 2));

  const colored = record({ color: ['#301000', '#ffb000'] });
  const c = frameMarkup(colored, 0);
  assert.match(c.content, /<span style="color:#[0-9a-f]{6}">/);
  assert.equal(stripTags(c.content), recordingText(colored, 0));
  // spans are balanced on every row
  for (const row of c.content.split('\n')) assert.equal(row.split('<span').length, row.split('</span>').length);
});

test('player: glyphs that mean something in HTML are escaped', () => {
  const rec: Recording = {
    width: 3, height: 1, aspect: 2, fps: 30, glyphs: [' ', '<', '&'], styles: ['', '#ff0000'], bg: null, meta: {},
    frames: [{ glyph: new Uint8Array([1, 2, 0]), style: new Uint8Array([1, 1, 0]) }],
  };
  // spaces do not close a span (they show no color anyway), so the trailing space stays inside
  assert.equal(frameMarkup(rec, 0).content, '<span style="color:#ff0000">&lt;&amp; </span>');
});

test('player: timing and scrubbing wrap around the loop', () => {
  assert.equal(advance(0, 0.1, 30, 120), 3);
  assert.equal(advance(119, 0.1, 30, 120), 2);
  // a tab switch does not jump ahead
  assert.equal(advance(10, 5, 30, 120), 13);
  assert.equal(scrub(0, 500, 1000, 120), 60);
  assert.equal(scrub(10, -1000, 1000, 120), 10);
  assert.equal(scrub(5, -250, 1000, 120), 95);
  assert.equal(scrub(5, 100, 0, 120), 5);
});

test('player: fit keeps the proportions the file was rendered for', () => {
  // a font with 10x20 cells and a file made for aspect 2: no stretch needed
  let f = fit(100, 50, 2, 10, 20, 500, 0);
  assert.equal(f.stretchY, 1);
  assert.equal(f.scale, 0.5);
  assert.equal(f.ratio, 1);
  // a squatter web font (10x15) gets stretched back to aspect 2
  f = fit(100, 50, 2, 10, 15, 500, 0);
  assert.ok(Math.abs(f.stretchY - 4 / 3) < 1e-9);
  assert.ok(Math.abs(f.ratio - 1) < 1e-9);
  // a box with a fixed height: the smaller side decides
  f = fit(100, 50, 2, 10, 20, 500, 250);
  assert.equal(f.scale, 0.25);
});

test('player: accessible label', () => {
  const rec = record();
  assert.equal(accessibleLabel(rec, null), 'ROCKET, ASCII animation');
  assert.equal(accessibleLabel(rec, 'Our logo'), 'Our logo');
  assert.equal(accessibleLabel(null, null), 'ASCII animation');
});
