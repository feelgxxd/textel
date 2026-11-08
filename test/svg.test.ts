// Animated SVG: every frame is in it, in order, with the right text, colors and timing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExample, EXAMPLES } from '../src/examples.ts';
import { recordingText, recordLoop, type Recording } from '../src/frames.ts';
import { createRenderer } from '../src/render.ts';
import { mergeStyles, type StyleInput } from '../src/style.ts';
import { recordingSVG } from '../src/svg.ts';

const record = (look: StyleInput = {}, frames = 6) => {
  const ex = EXAMPLES.find((e) => e.name === 'gem')!;
  return recordLoop(createRenderer(buildExample(ex), mergeStyles(ex.style, { width: 40, height: 16, aspect: 2 }, look)), { frames, fps: 12 });
};
const unescape = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** the text of each frame, rebuilt from the SVG rows and their x positions */
function framesOf(svg: string, rec: Recording, cell = 8): string[] {
  return [...svg.matchAll(/<g[^>]*>([\s\S]*?)<\/g>/g)].map(([, body]) => {
    const rows = Array.from({ length: rec.height }, () => ' '.repeat(rec.width));
    for (const [, x, y, inner] of body.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>(.*?)<\/text>/g)) {
      const r = Math.floor(Number(y) / (cell * rec.aspect)), c = Math.round(Number(x) / cell), s = unescape(inner);
      rows[r] = rows[r].slice(0, c) + s + rows[r].slice(c + s.length);
    }
    return rows.join('\n');
  });
}

test('svg: every frame, in order, with exactly the recorded text', () => {
  const rec = record();
  const svg = recordingSVG(rec, { title: 'a <gem>' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="320" height="256"/, '40x16 cells of 8x16 px');
  assert.match(svg, /<title>a &lt;gem&gt;<\/title>/, 'titles are escaped');
  const frames = framesOf(svg, rec);
  assert.equal(frames.length, 6);
  frames.forEach((f, i) => assert.equal(f, recordingText(rec, i), `frame ${i}`));
});

test('svg: frames take turns in one loop, and stand still without motion', () => {
  const svg = recordingSVG(record());
  // 6 frames at 12 fps: a 0.5 s loop, each frame shown for its sixth of it
  assert.match(svg, /animation:t 0\.5s steps\(1,end\) infinite/);
  assert.match(svg, /@keyframes t\{0%\{visibility:visible\}16.6667%\{visibility:hidden\}\}/);
  const delays = [...svg.matchAll(/id="f(\d+)" style="animation-delay:([\d.]+)s"/g)].map(([, i, d]) => [Number(i), Number(d)]);
  assert.deepEqual(delays, [[0, 0], [1, 0.0833], [2, 0.1667], [3, 0.25], [4, 0.3333], [5, 0.4167]]);
  assert.match(svg, /prefers-reduced-motion:reduce\)\{\.f\{animation:none\}#f0\{visibility:visible\}/);
  const still = recordingSVG(record({}, 1));
  assert.doesNotMatch(still, /animation|class="f"/, 'one frame needs no animation');
});

test('svg: colors become classes, and the theme picks the text color', () => {
  const plain = recordingSVG(record());
  assert.match(plain, /fill:#24292f/);
  assert.match(plain, /prefers-color-scheme:dark\)\{text\{fill:#e6edf3\}/, 'light and dark READMEs both read it');

  const rec = record({ color: ['#2a1400', '#ffb000'] });
  const svg = recordingSVG(rec);
  const classes = new Set([...svg.matchAll(/<tspan class="(c\w+)">/g)].map(([, c]) => c));
  assert.ok(classes.size > 3, 'a gradient uses several colors');
  for (const c of classes) assert.match(svg, new RegExp(`\\.${c}\\{fill:#[0-9a-f]{6}\\}`), `${c} is defined`);
  assert.doesNotMatch(svg, /fill="#/, 'no repeated inline colors');

  const fixed = recordingSVG(rec, { background: '#101010', color: '#00ff66' });
  assert.match(fixed, /<rect width="100%" height="100%" fill="#101010"\/>/);
  assert.match(fixed, /fill:#00ff66/);
  assert.doesNotMatch(fixed, /prefers-color-scheme/, 'a fixed background keeps its text color');
  assert.match(recordingSVG(rec, { background: '#f4efe4' }), /text\{[^}]*fill:#111\}/, 'dark text on a light background');
});
