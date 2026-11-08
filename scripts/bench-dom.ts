// Browser benchmark for the viewer's output path, served by npm run demo at /bench.
// Each method draws the same spinning model; the page reports how long the DOM update takes and
// how many frames per second the browser really shows.
import { buildExample, EXAMPLES } from '../src/examples.ts';
import { toHTML, toText } from '../src/output.ts';
import type { Frame } from '../src/render.ts';
import { createRenderer } from '../src/render.ts';
import { mergeStyles } from '../src/style.ts';

type Draw = (frame: Frame) => void;

// set when the demo server builds this page
declare const BUILT: string;

/** each method gets a fresh <pre> and returns how to draw a frame into it */
const METHODS: Record<string, (pre: HTMLPreElement, frame0: Frame) => Draw> = {
  // what the viewer does today
  'innerHTML, whole frame': (pre) => (f) => { pre.innerHTML = toHTML(f); },
  // colorless only: the whole text at once
  'textContent, whole frame': (pre) => (f) => { pre.textContent = toText(f); },
  // colorless only: one text node per row, only changed rows touched
  'text node per row, changed rows': (pre, f0) => {
    const nodes: Text[] = [];
    for (let r = 0; r < f0.height; r++) {
      nodes.push(document.createTextNode(''));
      pre.append(nodes[r], '\n');
    }
    return (f) => {
      const W = f.width;
      for (let r = 0; r < f.height; r++) {
        const s = f.chars.slice(r * W, r * W + W).join('');
        if (nodes[r].data !== s) nodes[r].data = s;
      }
    };
  },
  // with color: classes from a small stylesheet instead of an inline style on every span
  'innerHTML, color classes': (pre) => {
    const sheet = document.createElement('style'), ids = new Map<string, string>();
    pre.before(sheet);
    return (f) => {
      pre.innerHTML = toHTML(f).replace(/style="color:(#[0-9a-f]{6})"/g, (_, hex: string) => {
        let id = ids.get(hex);
        if (!id) {
          id = `c${ids.size}`;
          ids.set(hex, id);
          sheet.textContent += `.${id}{color:${hex}}`;
        }
        return `class="${id}"`;
      });
    };
  },
  // with color: one element per row, rows rewritten only when they changed
  'innerHTML per row, changed rows': (pre, f0) => {
    const rows: HTMLSpanElement[] = [], last: string[] = [];
    for (let r = 0; r < f0.height; r++) {
      rows.push(document.createElement('span'));
      pre.append(rows[r], '\n');
    }
    return (f) => {
      const lines = toHTML(f).split('\n');
      for (let r = 0; r < lines.length; r++) if (last[r] !== lines[r]) { rows[r].innerHTML = lines[r]; last[r] = lines[r]; }
    };
  },
};

const out = document.getElementById('out')!;
const stage = document.getElementById('stage')!;
const log = (s: string) => (out.textContent += s + '\n');

async function run(example: string, colored: boolean, cols: number, rows: number, frames: number) {
  const ex = EXAMPLES.find((e) => e.name === example)!;
  const r = createRenderer(buildExample(ex), mergeStyles(ex.style, { width: cols, height: rows, aspect: 2 }, colored ? { color: ['#2a1400', '#ffb000'] } : { materials: {} }));
  // render every frame up front, so only the DOM work is timed
  const all: Frame[] = [];
  for (let i = 0; i < frames; i++) all.push(r.render({ yaw: (i / frames) * Math.PI * 2 }));
  // what the frames cost to describe, so a run shows which code it used
  let spans = 0, bytes = 0;
  for (const f of all) {
    const h = toHTML(f);
    spans += h.split('<span').length - 1;
    bytes += h.length;
  }
  log(`\n${example}, ${colored ? 'gradient color' : 'no color'}, ${cols}x${rows}, ${frames} frames: ${Math.round(spans / frames)} spans, ${(bytes / frames / 1024).toFixed(0)} KB of HTML per frame`);
  for (const [name, make] of Object.entries(METHODS)) {
    if (colored && (name.startsWith('textContent') || name.startsWith('text node'))) continue;
    stage.replaceChildren();
    const pre = document.createElement('pre');
    stage.append(pre);
    const draw = make(pre, all[0]);
    draw(all[0]);
    await new Promise(requestAnimationFrame);
    let js = 0, i = 0;
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const tick = () => {
        const a = performance.now();
        draw(all[i % frames]);
        // reading a size forces style and layout now, so their cost is counted too
        void pre.offsetHeight;
        js += performance.now() - a;
        if (++i < frames) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    const fps = (frames * 1000) / (performance.now() - t0);
    log(`  ${name.padEnd(34)} ${(js / frames).toFixed(2).padStart(6)} ms per frame   ${fps.toFixed(0).padStart(3)} fps`);
  }
}

document.getElementById('go')!.addEventListener('click', async (e) => {
  (e.target as HTMLButtonElement).disabled = true;
  out.textContent = `${navigator.userAgent}\nbuilt ${BUILT}\n`;
  for (const colored of [false, true]) {
    await run('gem', colored, 96, 48, 240);
    await run('mug', colored, 160, 80, 240);
  }
  stage.replaceChildren();
  log('\ndone');
  (e.target as HTMLButtonElement).disabled = false;
});
