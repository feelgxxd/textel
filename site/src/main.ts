// The textel playground: drop a model, tune the look, take it to a page or a terminal.
// Everything runs in the browser; models are never uploaded.
import '../../src/browser/viewer.ts';
import type { TextelViewer } from '../../src/browser/viewer.ts';
import { EXAMPLES } from '../../src/examples.ts';
import { RecordingBuilder, recordingSVG, stringifyFrames } from '../../src/frames.ts';
import playerSource from 'virtual:textel-player';
import { encodeGIF } from './gif.ts';
import { indexed, inkPalette, rasterize } from './raster.ts';
import { canEncodeVideo, encodeMP4 } from './video.ts';
import { parseModelAsync } from '../../src/loaders/index.ts';
import type { Mesh } from '../../src/mesh.ts';
import { createRenderer } from '../../src/render.ts';
import { DEFAULTS, mergeStyles, type EdgeMode, type MaterialInput } from '../../src/style.ts';
import {
  anglesFromLight, CHARSET_NAMES, cliCommand, decodeState, DEFAULT_STATE, embedSnippet, encodeState, lightFromAngles,
  needsPreset, presetJSON, PRESETS, standaloneHTML, type State,
} from './state.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewer = $<TextelViewer>('viewer');
const preview = $('preview'), statusLine = $('status'), busy = $('busy'), panels = $('panels');

let state: State = structuredClone(DEFAULT_STATE);
let mesh: Mesh | null = null;
/** used to name exported files */
let modelFile = 'your-model.glb';

// ---------- tiny DOM helpers ----------

type Props = Record<string, unknown>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v !== undefined && v !== false && v !== null) el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...kids);
  return el;
}

/** every control registers how to show the current state, so presets and links can refresh them all */
const syncs: (() => void)[] = [];

function field(label: string, control: HTMLElement, out?: HTMLElement) {
  return h('label', { class: 'field' }, h('span', { class: 'name' }, label), control, ...(out ? [out] : []));
}

function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt = (v: number) => String(v)) {
  const input = h('input', { type: 'range', min, max, step });
  const out = h('output');
  input.addEventListener('input', () => { set(Number(input.value)); out.textContent = fmt(Number(input.value)); changed(); });
  syncs.push(() => { input.value = String(get()); out.textContent = fmt(get()); });
  return field(label, input, out);
}

function select(label: string, options: [string, string][], get: () => string, set: (v: string) => void) {
  const el = h('select', {}, ...options.map(([v, t]) => h('option', { value: v }, t)));
  el.addEventListener('change', () => { set(el.value); changed(); });
  syncs.push(() => { el.value = get(); });
  return field(label, el);
}

function colorPicker(label: string, get: () => string, set: (v: string) => void) {
  const el = h('input', { type: 'color' });
  el.addEventListener('input', () => { set(el.value); changed(); });
  syncs.push(() => { el.value = get(); });
  return field(label, el);
}

function section(title: string, open: boolean, ...body: HTMLElement[]) {
  return h('details', { class: 'panel', ...(open ? { open: true } : {}) }, h('summary', {}, title), ...body);
}

function download(data: string | Blob, name: string, type = 'application/json') {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data);
  const a = h('a', { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text: string, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(text);
    const was = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = was), 1200);
  } catch {
    button.textContent = 'Copy failed: select and copy by hand';
  }
}

// ---------- the look, read and written through small accessors ----------

const colorMode = () => (state.look.color === 'model' ? 'model' : Array.isArray(state.look.color) && state.look.color.length > 1 ? 'gradient' : typeof state.look.color === 'string' && state.look.color !== 'none' ? 'mono' : 'none');
const colorAt = (i: 0 | 1) => {
  const c = state.look.color;
  if (Array.isArray(c)) return c[Math.min(i, c.length - 1)];
  return typeof c === 'string' && c.startsWith('#') ? c : i ? '#ffb000' : '#2a1400';
};
const setColor = (mode: string, from = colorAt(0), to = colorAt(1)) => {
  state.look.color = mode === 'gradient' ? [from, to] : mode === 'mono' ? to : mode === 'model' ? 'model' : undefined;
  showStatus();
};
const light = () => anglesFromLight(state.look.light ?? [-0.3, 0.35, 0.88]);

// ---------- panels ----------

const charsetOptions: [string, string][] = [...CHARSET_NAMES.map((n): [string, string] => [n, n]), ['custom', 'custom…']];
const customChars = h('input', { type: 'text', placeholder: 'darkest to brightest, e.g.  .:+#@', spellcheck: false });
customChars.addEventListener('input', () => { state.look.chars = customChars.value || undefined; changed(); });
syncs.push(() => { customChars.value = state.look.chars ?? ''; customChars.hidden = state.look.chars === undefined; });

const materialsBox = h('div', { class: 'materials' });
const materialsPanel = section('Materials', true, h('p', { class: 'note' }, 'Parts of the model, by the names in the file.'), materialsBox);

function buildMaterials() {
  materialsBox.replaceChildren();
  const names = mesh?.materials ?? [];
  materialsPanel.hidden = names.length < 2;
  for (const name of names) {
    const get = () => {
      const m = state.look.materials?.[name];
      return typeof m === 'string' ? m : 'solid';
    };
    const sel = select(name, [['solid', 'solid'], ['carved', 'carved (blank, still hides)'], ['dim', 'dim']], get, (v) => {
      state.look.materials = { ...state.look.materials, [name]: v as MaterialInput };
    });
    materialsBox.append(sel);
  }
  for (const s of syncs) s();
}

const exportsBox = h('div', { class: 'exports' });

panels.append(
  section('Start from', true,
    h('div', { class: 'presets' }, ...PRESETS.map((p) => h('button', {
      type: 'button',
      style: `color:${p.page.fg};background:${p.page.bg}`,
      onclick: () => {
        state.look = { ...state.look, ...p.look, chars: undefined };
        state.page = { ...p.page };
        for (const s of syncs) s();
        changed();
      },
    }, p.name))),
  ),
  section('Look', true,
    select('Characters', charsetOptions, () => (state.look.chars !== undefined ? 'custom' : state.look.charset ?? 'classic'), (v) => {
      if (v === 'custom') { state.look.chars = state.look.chars ?? ' .:-=+*#%@'; }
      else { state.look.charset = v; state.look.chars = undefined; }
      for (const s of syncs) s();
    }),
    customChars,
    select('Color', [['none', 'none (page color)'], ['mono', 'one color'], ['gradient', 'gradient'], ['model', "the model's own"]], colorMode, (v) => { setColor(v); for (const s of syncs) s(); }),
    colorPicker('From (dark)', () => colorAt(0), (v) => setColor('gradient', v, colorAt(1))),
    colorPicker('To (bright)', () => colorAt(1), (v) => setColor(colorMode() === 'mono' ? 'mono' : 'gradient', colorAt(0), v)),
    select('Outline', [['off', 'off'], ['outline', 'silhouette'], ['depth', 'silhouette and depth steps'], ['crease', 'all of those and folds']],
      () => (state.look.edges ? String(state.look.edges) : 'off'),
      (v) => { state.look.edges = v === 'off' ? false : (v as EdgeMode); }),
    select('Shading', [['auto', 'auto'], ['smooth', 'smooth'], ['flat', 'flat (facets)']], () => state.look.shading ?? 'auto', (v) => { state.look.shading = v === 'auto' ? undefined : (v as 'flat' | 'smooth'); }),
    slider('Ambient', 0, 0.6, 0.02, () => state.look.ambient ?? 0, (v) => { state.look.ambient = v || undefined; }, (v) => v.toFixed(2)),
  ),
  section('Light', false,
    slider('Around', -180, 180, 5, () => light()[0], (v) => { state.look.light = lightFromAngles(v, light()[1]); }, (v) => `${v}°`),
    slider('Height', -85, 85, 5, () => light()[1], (v) => { state.look.light = lightFromAngles(light()[0], v); }, (v) => `${v}°`),
  ),
  section('Camera and motion', false,
    slider('Tilt', -1.2, 1.2, 0.05, () => state.look.pitch ?? 0.3, (v) => { state.look.pitch = v; }, (v) => v.toFixed(2)),
    slider('Spin', -3, 3, 0.05, () => state.look.spin ?? 0.66, (v) => { state.look.spin = v; }, (v) => (v === 0 ? 'still' : v.toFixed(2))),
    slider('Zoom', 0.3, 2, 0.05, () => state.look.zoom ?? 1, (v) => { state.look.zoom = v === 1 ? undefined : v; }, (v) => v.toFixed(2)),
    slider('Perspective', 1.6, 12, 0.2, () => state.look.distance ?? 5, (v) => { state.look.distance = v === 5 ? undefined : v; }, (v) => (v > 9 ? 'flat' : v.toFixed(1))),
    slider('Width', 40, 200, 4, () => state.cols, (v) => { state.cols = v; }, (v) => `${v} chars`),
  ),
  section('Page', false,
    colorPicker('Text', () => state.page.fg, (v) => { state.page.fg = v; }),
    colorPicker('Background', () => state.page.bg, (v) => { state.page.bg = v; }),
  ),
  materialsPanel,
  section('Share and export', true, exportsBox),
);

// ---------- exports ----------

const tabs = ['Live on a page', 'Recorded loop', 'Image', 'Terminal', 'Preset'] as const;
let tab: (typeof tabs)[number] = tabs[0];
const shareButton = h('button', { type: 'button', class: 'primary' }, 'Copy link to this look');
shareButton.addEventListener('click', async () => {
  history.replaceState(null, '', '#' + (await encodeState(state)));
  copy(location.href, shareButton);
});

function codeBlock(text: string) {
  const area = h('textarea', { readonly: true, rows: String(Math.min(8, text.split('\n').length + 1)), spellcheck: false });
  area.value = text;
  const btn = h('button', { type: 'button' }, 'Copy');
  btn.addEventListener('click', () => copy(text, btn));
  return h('div', { class: 'code' }, area, btn);
}

const presetButton = () => h('button', { type: 'button', onclick: () => download(presetJSON(state.look), 'look.json') }, 'Download look.json');

let recording = false, svgPageColors = false, made = '', progressText = '';
function renderExports() {
  const base = modelFile.replace(/\.[a-z0-9]+$/i, '');
  const body: HTMLElement[] = [];
  if (tab === 'Live on a page') {
    body.push(h('p', { class: 'note' }, `Put ${modelFile} next to your page. The viewer is about 16 KB and renders it live.`));
    body.push(codeBlock(embedSnippet(state, 'viewer', modelFile)));
    if (needsPreset(state.look)) body.push(h('p', { class: 'note' }, 'This look uses settings only a preset file carries; save it next to the page too.'), presetButton());
  } else if (tab === 'Recorded loop') {
    const rec = h('button', { type: 'button', class: 'primary', disabled: !mesh || recording }, `Record ${base}.textel.json`);
    rec.addEventListener('click', () => recordLoop(rec, base, 'json'));
    const page = h('button', { type: 'button', disabled: !mesh || recording }, `Make ${base}.html`);
    page.addEventListener('click', () => recordLoop(page, base, 'html'));
    body.push(h('p', { class: 'note' }, 'One full turn rendered once and saved as a file. The player is about 3 KB and needs no 3D code.'), rec);
    body.push(codeBlock(embedSnippet(state, 'player', `${base}.textel.json`)));
    body.push(h('p', { class: 'note' }, 'Or everything in one HTML file, player included: it opens anywhere, offline too.'), page);
    if (recording) body.push(h('p', { class: 'note' }, progressText));
    else if (made) body.push(h('p', { class: 'note' }, made));
  } else if (tab === 'Image') {
    const make = (kind: 'svg' | 'gif' | 'mp4', primary = false) => {
      const b = h('button', { type: 'button', class: primary ? 'primary' : '', disabled: !mesh || recording }, `Make ${base}.${kind}`);
      b.addEventListener('click', () => recordLoop(b, base, kind));
      return b;
    };
    const pageColors = h('input', { type: 'checkbox', checked: svgPageColors, onchange: (e: Event) => { svgPageColors = (e.target as HTMLInputElement).checked; } });
    body.push(
      h('p', { class: 'note' }, 'An animated SVG plays anywhere an image does, with no script: a GitHub README, docs, a blog. Without page colors it is transparent and follows the reader\'s light or dark theme.'),
      h('label', { class: 'check' }, pageColors, ' Use the page colors'),
      make('svg', true),
      codeBlock(`![${base}](${base}.svg)`),
      h('p', { class: 'note' }, 'A GIF or a video for chats and social posts, in the page colors. The video is twice as sharp; the GIF plays everywhere.'),
      h('div', { class: 'row' }, make('gif'), ...(canEncodeVideo() ? [make('mp4')] : [])),
      h('p', { class: 'note' }, 'A still picture of the preview as it is now: turn it to the angle you like first.'),
      h('div', { class: 'row' }, snapshotButton(base)),
    );
    if (recording) body.push(h('p', { class: 'note' }, progressText));
    else if (made) body.push(h('p', { class: 'note' }, made));
  } else if (tab === 'Terminal') {
    body.push(h('p', { class: 'note' }, 'Needs Node 22 or newer.'));
    body.push(codeBlock(cliCommand(state, 'preview', modelFile) + '\n' + cliCommand(state, 'render', modelFile)));
    if (needsPreset(state.look)) body.push(presetButton());
  } else {
    body.push(h('p', { class: 'note' }, 'Everything about the look. Works with the CLI (--preset), the viewer (preset="…") and the library.'));
    body.push(codeBlock(presetJSON(state.look)), presetButton());
  }
  exportsBox.replaceChildren(
    shareButton,
    h('div', { class: 'tabs', role: 'tablist' }, ...tabs.map((t) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(t === tab),
      onclick: () => { tab = t; renderExports(); },
    }, t))),
    ...body,
  );
}

async function recordLoop(button: HTMLButtonElement, base: string, kind: 'json' | 'html' | 'svg' | 'gif' | 'mp4') {
  if (!mesh) return;
  recording = true;
  made = '';
  for (const b of exportsBox.querySelectorAll<HTMLButtonElement>('button:not([role=tab])')) b.disabled = true;
  const say = async (text: string) => {
    progressText = button.textContent = text;
    await new Promise((res) => setTimeout(res));
  };
  const name = kind === 'json' ? `${base}.textel.json` : `${base}.${kind}`;
  try {
    // a recorded loop plays back from data; the images store every frame whole, so fewer frames and
    // cells keep them light. All of them take 4 s for a turn
    const [width, height, frames, fps] = kind === 'json' || kind === 'html' ? [112, 56, 120, 30] : [80, 40, 80, 20];
    const r = createRenderer(mesh, mergeStyles(state.look, { width, height, aspect: 2 }));
    const b = new RecordingBuilder();
    for (let i = 0; i < frames; i++) {
      b.add(r.render({ yaw: (i / frames) * Math.PI * 2 }));
      if (i % 8 === 7) await say(`Rendering… ${Math.round(((i + 1) / frames) * 100)}%`);
    }
    const rec = b.build(fps, { title: base, generator: 'textel playground' });
    let file: BlobPart, type: string;
    if (kind === 'json') [file, type] = [stringifyFrames(rec), 'application/json'];
    else if (kind === 'html') [file, type] = [standaloneHTML(stringifyFrames(rec), playerSource, { title: base, page: state.page, ratio: rec.width / (rec.height * rec.aspect) }), 'text/html'];
    else if (kind === 'svg') [file, type] = [recordingSVG(rec, { title: base, ...(svgPageColors ? { color: state.page.fg, background: state.page.bg } : {}) }), 'image/svg+xml'];
    else {
      const look = { color: state.page.fg, background: state.page.bg };
      if (kind === 'gif') {
        const raster = rasterize(rec, { ...look, cell: 8 }), pal = inkPalette(raster.inks), px: Uint8Array[] = [];
        for (let i = 0; i < frames; i++) {
          px.push(indexed(raster.draw(i), raster.width, raster.height, pal));
          if (i % 4 === 3) await say(`Drawing… ${Math.round(((i + 1) / frames) * 100)}%`);
        }
        await say('Encoding…');
        [file, type] = [encodeGIF({ width: raster.width, height: raster.height, palette: pal.palette, frames: px, delay: 100 / fps }), 'image/gif'];
      } else {
        const raster = rasterize(rec, { ...look, cell: 16, even: true });
        [file, type] = [await encodeMP4(raster, frames, fps, async (n) => { if (n % 4 === 0) await say(`Encoding… ${Math.round((n / frames) * 100)}%`); }), 'video/mp4'];
      }
    }
    const blob = new Blob([file], { type });
    download(blob, name);
    made = `Made ${name}: ${size(blob.size)}`;
  } catch (e) {
    made = `Could not make ${name}: ${(e as Error).message}`;
  } finally {
    recording = false;
    renderExports();
  }
}

function snapshotButton(base: string) {
  const b = h('button', { type: 'button', disabled: !mesh || recording }, `Make ${base}.png`);
  b.addEventListener('click', async () => {
    if (!mesh) return;
    const name = `${base}.png`;
    try {
      // the preview's own camera, on a bigger grid
      const { yaw, pitch, zoom, fitPitch } = viewer.view;
      const r = createRenderer(mesh, mergeStyles(state.look, { width: 112, height: 56, aspect: 2, zoom, fitPitch }));
      const builder = new RecordingBuilder();
      builder.add(r.render({ yaw, pitch }));
      const rec = builder.build(1, { title: base });
      const raster = rasterize(rec, { color: state.page.fg, background: state.page.bg, cell: 14 });
      raster.draw(0);
      const blob = await new Promise<Blob | null>((res) => raster.canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('the browser made no image');
      download(blob, name);
      made = `Made ${name}: ${size(blob.size)}, ${raster.width}×${raster.height}`;
    } catch (e) {
      made = `Could not make ${name}: ${(e as Error).message}`;
    }
    renderExports();
  });
  return b;
}

const size = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// ---------- applying the state ----------

let hashTimer = 0;
function changed() {
  viewer.look = { ...state.look };
  viewer.setAttribute('cols', String(state.cols));
  preview.style.color = state.page.fg;
  preview.style.background = state.page.bg;
  renderExports();
  // keep the address bar current, quietly
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(async () => history.replaceState(null, '', '#' + (await encodeState(state))), 400);
}

function showStatus() {
  if (!mesh) return;
  const tris = mesh.indices.length / 3;
  const mats = mesh.materials.length > 1 ? ` · ${mesh.materials.length} materials` : '';
  // past this the renderer draws a simplified copy; the embed still downloads the whole file
  const heavy = tris > DEFAULTS.maxTriangles ? ' · drawn simplified, it looks the same; embeds still load the whole file' : '';
  const textures = mesh.textured && state.look.color === 'model' ? " · its colors come from image textures, which textel can't read yet" : '';
  statusLine.textContent = `${modelFile} · ${tris.toLocaleString()} triangles${mats}${heavy}${textures}`;
}

function setMesh(m: Mesh, file: string) {
  mesh = m;
  modelFile = file;
  viewer.mesh = m;
  buildMaterials();
  showStatus();
  changed();
}

async function withBusy<T>(text: string, work: () => Promise<T>): Promise<T | undefined> {
  busy.textContent = text;
  busy.hidden = false;
  try {
    return await work();
  } catch (e) {
    statusLine.textContent = (e as { code?: string }).code === 'DRACO_DECODER_NEEDED'
      ? 'Could not load it: it uses Draco compression, which the playground cannot read yet. Export it without Draco (meshopt compression works), or use the textel command.'
      : `Could not load it: ${(e as Error).message}`;
    return undefined;
  } finally {
    busy.hidden = true;
  }
}

async function loadExample(name: string) {
  const ex = EXAMPLES.find((e) => e.name === name);
  if (!ex) return;
  const m = await withBusy(`Building ${name}…`, async () => {
    // examples are built from code; do it in slices so the page keeps moving
    const g = ex.build();
    let t = performance.now();
    for (;;) {
      const r = g.next();
      if (r.done) return r.value;
      if (performance.now() - t > 12) { await new Promise((res) => setTimeout(res)); t = performance.now(); }
    }
  });
  if (!m) return;
  state.example = name;
  // keep the example's own parts working (the dice pips are carved, for example)
  if (ex.style.materials) state.look.materials = { ...ex.style.materials, ...state.look.materials };
  setMesh(m, `${name}.glb`);
}

async function loadFiles(files: File[]) {
  const main = files.find((f) => /\.(glb|gltf|obj|stl)$/i.test(f.name)) ?? files[0];
  if (!main) return;
  // a .gltf may come with its .bin, an .obj with its .mtl, in the same drop
  const others = new Map<string, Uint8Array>();
  for (const f of files) if (f !== main) others.set(f.name, new Uint8Array(await f.arrayBuffer()));
  const m = await withBusy(`Reading ${main.name}…`, async () => parseModelAsync(new Uint8Array(await main.arrayBuffer()), main.name, {
    resolve: (uri) => {
      const b = others.get(uri.split('/').pop()!);
      if (!b) throw new Error(`${uri} is missing: drop it together with ${main.name}`);
      return b;
    },
  }));
  if (!m) return;
  state.example = undefined;
  setMesh(m, main.name);
}

// ---------- input ----------

$('examples').append(...EXAMPLES.map((e) => h('button', { type: 'button', class: 'link', onclick: () => loadExample(e.name) }, e.name)));
$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) loadFiles([...input.files]);
  input.value = '';
});

const overlay = $('drop-overlay');
let depth = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; overlay.hidden = false; } });
addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; overlay.hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  depth = 0;
  overlay.hidden = true;
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) loadFiles(files);
});

viewer.addEventListener('error', (e) => { statusLine.textContent = `Could not show it: ${(e as unknown as CustomEvent).detail.error.message}`; });

// ---------- start ----------

(async () => {
  const shared = await decodeState(location.hash);
  if (shared) state = shared;
  for (const s of syncs) s();
  changed();
  await loadExample(state.example ?? 'gem');
})();
