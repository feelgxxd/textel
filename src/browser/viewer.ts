// <textel-viewer>: renders a 3D model live in the page; drag to turn it.
//
//   <script type="module" src="https://cdn.jsdelivr.net/npm/@feelgxxd/textel@0.3/dist/textel-viewer.js"></script>
//   <textel-viewer src="model.glb" charset="hard" color="#301000,#ffb000"></textel-viewer>
import { parseModel } from '../loaders/index.ts';
import type { Mesh } from '../mesh.ts';
import { toHTML } from '../output.ts';
import { createRenderer, type Renderer } from '../render.ts';
import { mergeStyles, type StyleInput } from '../style.ts';
import { drag, gridFor, step, styleFromAttributes, type Grid, type Motion } from './viewer-core.ts';

const CSS = `:host{display:block;position:relative;overflow:hidden;aspect-ratio:var(--textel-ratio,1);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;outline:none}
:host(:not([nodrag])){cursor:grab;touch-action:pan-y}
:host(:not([nodrag]):active){cursor:grabbing}
:host(:focus-visible){box-shadow:0 0 0 2px currentColor}
pre{position:absolute;left:0;top:0;margin:0;transform-origin:0 0;font:inherit;font-size:16px;line-height:1;letter-spacing:0;white-space:pre;color:inherit;text-shadow:var(--textel-glow,none);-webkit-text-size-adjust:none;text-size-adjust:none;user-select:none;pointer-events:none}
.probe{visibility:hidden}`;

const MAX_PITCH = 1.2;
const STYLE_ATTRS = ['charset', 'chars', 'color', 'edges', 'spin', 'pitch', 'zoom', 'distance', 'ambient'];

const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

/** fetches a model; a .gltf brings its external buffers along */
async function fetchModel(url: string, signal: AbortSignal): Promise<Mesh> {
  const get = async (u: string) => {
    const res = await fetch(u, { signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${u}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const bytes = await get(url);
  const buffers = new Map<string, Uint8Array>();
  if (/\.gltf(\?|#|$)/i.test(url)) {
    const json = JSON.parse(new TextDecoder().decode(bytes)) as { buffers?: { uri?: string }[] };
    for (const b of json.buffers ?? []) {
      if (b.uri && !b.uri.startsWith('data:')) buffers.set(decodeURIComponent(b.uri), await get(new URL(b.uri, new URL(url, location.href)).href));
    }
  }
  return parseModel(bytes, url.split(/[?#]/)[0], {
    resolve: (uri) => {
      const b = buffers.get(uri);
      if (!b) throw new Error(`missing buffer ${uri}`);
      return b;
    },
  });
}

export class TextelViewer extends Base {
  static observedAttributes = ['src', 'preset', 'cols', 'paused', 'label', ...STYLE_ATTRS];

  #pre!: HTMLPreElement;
  #probe!: HTMLPreElement;
  #mesh: Mesh | null = null;
  #renderer: Renderer | null = null;
  #preset: StyleInput = {};
  #look: StyleInput = {};
  #grid: Grid | null = null;
  #motion: Motion = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 };
  #zoom = 1;
  #playing = true;
  #visible = true;
  #raf = 0;
  #last = -1;
  #dirty = true;
  #pointer: { x: number; y: number; t: number } | null = null;
  #load: AbortController | null = null;
  #io?: IntersectionObserver;
  #ro?: ResizeObserver;
  #reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.#pre = document.createElement('pre');
    this.#pre.setAttribute('part', 'screen');
    this.#probe = document.createElement('pre');
    this.#probe.className = 'probe';
    // 40 glyphs on each of 4 lines: one glyph's width and one line's height, averaged
    this.#probe.textContent = Array(4).fill('M'.repeat(40)).join('\n');
    root.append(style, this.#probe, this.#pre);
    this.addEventListener('pointerdown', this.#onDown);
    this.addEventListener('pointermove', this.#onMove);
    this.addEventListener('pointerup', this.#onUp);
    this.addEventListener('pointercancel', this.#onUp);
    this.addEventListener('keydown', this.#onKey);
    this.addEventListener('wheel', this.#onWheel, { passive: false });
  }

  connectedCallback() {
    this.setAttribute('role', 'img');
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    this.#updateLabel();
    this.#playing = !this.hasAttribute('paused');
    if (typeof IntersectionObserver === 'function') {
      this.#io = new IntersectionObserver(([e]) => { this.#visible = e.isIntersecting; this.#kick(); });
      this.#io.observe(this);
    }
    if (typeof ResizeObserver === 'function') {
      this.#ro = new ResizeObserver(() => this.#layout());
      this.#ro.observe(this);
    }
    this.ownerDocument.addEventListener('visibilitychange', this.#kick);
    this.ownerDocument.fonts?.ready.then(() => this.#layout());
    this.#layout();
    this.#kick();
  }

  disconnectedCallback() {
    this.#io?.disconnect();
    this.#ro?.disconnect();
    this.ownerDocument.removeEventListener('visibilitychange', this.#kick);
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    if (old === value) return;
    if (name === 'src') { if (value) this.load(value); }
    else if (name === 'preset') { if (value) this.#fetchPreset(value); }
    else if (name === 'paused') { value === null ? this.play() : this.pause(); }
    else if (name === 'label') this.#updateLabel();
    else if (name === 'cols') this.#layout();
    else this.#restyle();
  }

  /** extra style from JavaScript, on top of the preset and the attributes */
  get look(): StyleInput { return this.#look; }
  set look(s: StyleInput) { this.#look = s ?? {}; this.#restyle(); }

  /** the model being shown; set a Mesh to show one built in code */
  get mesh(): Mesh | null { return this.#mesh; }
  set mesh(m: Mesh | null) {
    this.#mesh = m;
    this.#renderer = null;
    this.#motion = { yaw: 0, pitch: this.#style().pitch ?? 0.3, vyaw: 0, vpitch: 0 };
    this.#layout();
    this.#kick();
  }

  get paused(): boolean { return !this.#playing; }
  play() { this.#playing = true; this.#kick(); }
  /** stops at once: the spin and any flick still coasting are dropped */
  pause() {
    this.#playing = false;
    this.#motion = { ...this.#motion, vyaw: 0, vpitch: 0 };
    this.#kick();
  }

  /** loads a model from a URL, a File, or bytes */
  async load(source: string | Blob | ArrayBuffer | Uint8Array, name = '') {
    this.#load?.abort();
    const ac = (this.#load = new AbortController());
    try {
      let mesh: Mesh;
      if (typeof source === 'string') mesh = await fetchModel(source, ac.signal);
      else {
        const bytes = source instanceof Uint8Array ? source : new Uint8Array(source instanceof Blob ? await source.arrayBuffer() : source);
        mesh = parseModel(bytes, name || (source instanceof File ? source.name : ''));
      }
      if (ac.signal.aborted) return;
      this.mesh = mesh;
      this.dispatchEvent(new CustomEvent('load', { detail: { triangles: mesh.indices.length / 3, materials: mesh.materials } }));
    } catch (error) {
      if (ac.signal.aborted) return;
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
    }
  }

  async #fetchPreset(url: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      this.#preset = await res.json();
      this.#restyle();
    } catch (error) {
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
    }
  }

  /** preset < attributes < .look, then the parts the viewer owns */
  #style(): StyleInput {
    return mergeStyles(this.#preset, styleFromAttributes((n) => this.getAttribute(n)) as StyleInput, this.#look);
  }

  #restyle() {
    if (!this.#renderer || !this.#grid) return this.#layout();
    const s = this.#style();
    this.#renderer.setStyle({ ...s, ...this.#gridStyle(s) });
    // show the change now, even while paused
    this.#draw();
    this.#kick();
  }

  #gridStyle(s: StyleInput): StyleInput {
    const g = this.#grid!;
    return { width: g.cols, height: g.rows, aspect: g.aspect, zoom: (s.zoom ?? 1) * this.#zoom, fitPitch: this.hasAttribute('nodrag') ? 0 : MAX_PITCH };
  }

  #layout() {
    if (!this.isConnected) return;
    const p = this.#probe, cellW = p.offsetWidth / 40, cellH = p.offsetHeight / 4;
    const cols = Number(this.getAttribute('cols')) || 96;
    // A page-set height shapes the grid. Without one the box follows --textel-ratio (square at
    // first), so its height already matches the grid and the layout settles on the same rows.
    this.#grid = gridFor(cols, cellW, cellH, this.clientWidth, this.clientHeight);
    this.style.setProperty('--textel-ratio', String(this.#grid.ratio));
    this.#pre.style.transform = `scale(${this.#grid.scale})`;
    if (!this.#mesh) return;
    const s = this.#style();
    try {
      if (!this.#renderer) this.#renderer = createRenderer(this.#mesh, { ...s, ...this.#gridStyle(s) });
      else this.#renderer.setStyle({ ...s, ...this.#gridStyle(s) });
    } catch (error) {
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
      return;
    }
    this.#dirty = true;
    this.#draw();
  }

  #draw() {
    if (!this.#renderer) return;
    const frame = this.#renderer.render({ yaw: this.#motion.yaw, pitch: this.#motion.pitch });
    this.#pre.innerHTML = toHTML(frame);
    this.#dirty = false;
  }

  #updateLabel() {
    if (this.isConnected) this.setAttribute('aria-label', this.getAttribute('label') || '3D model drawn in ASCII');
  }

  #spin() {
    return this.#playing && !this.#reduced ? this.#style().spin ?? 0.66 : 0;
  }

  /** animates while it spins, coasts after a flick, or is being dragged; otherwise it stays still */
  #kick = () => {
    const m = this.#motion;
    const moving = this.#spin() !== 0 || Math.abs(m.vyaw) > 1e-3 || Math.abs(m.vpitch) > 1e-3 || !!this.#pointer;
    const run = !!this.#renderer && this.#visible && !this.ownerDocument.hidden && this.isConnected && (moving || this.#dirty);
    if (run && !this.#raf) {
      this.#last = -1;
      this.#raf = requestAnimationFrame(this.#tick);
    } else if (!run && this.#raf) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
  };

  #tick = (now: number) => {
    this.#raf = 0;
    const dt = this.#last < 0 ? 0 : (now - this.#last) / 1000;
    this.#last = now;
    if (!this.#pointer) {
      this.#motion = step(this.#motion, { spin: this.#spin(), pitch: this.#style().pitch ?? 0.3, maxPitch: MAX_PITCH }, dt);
    }
    this.#draw();
    this.#raf = requestAnimationFrame(this.#tick);
    // stop once everything has settled
    const m = this.#motion;
    if (this.#spin() === 0 && !this.#pointer && Math.abs(m.vyaw) < 1e-3 && Math.abs(m.vpitch) < 1e-3) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
  };

  #onDown = (e: PointerEvent) => {
    if (this.hasAttribute('nodrag') || !this.#renderer || e.button !== 0) return;
    this.#pointer = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.setPointerCapture(e.pointerId);
    this.#kick();
  };

  #onMove = (e: PointerEvent) => {
    const p = this.#pointer;
    if (!p) return;
    const now = performance.now();
    this.#motion = drag(this.#motion, e.clientX - p.x, e.clientY - p.y, (now - p.t) / 1000, this.clientWidth, MAX_PITCH);
    this.#pointer = { x: e.clientX, y: e.clientY, t: now };
    this.#kick();
  };

  #onUp = () => {
    if (!this.#pointer) return;
    // a pause before letting go means no flick
    if (performance.now() - this.#pointer.t > 80) this.#motion = { ...this.#motion, vyaw: 0, vpitch: 0 };
    this.#pointer = null;
    this.#kick();
  };

  #onKey = (e: KeyboardEvent) => {
    const m = this.#motion, step = 0.15;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => (m.yaw -= step),
      ArrowRight: () => (m.yaw += step),
      ArrowUp: () => (m.pitch = Math.max(-MAX_PITCH, m.pitch - step)),
      ArrowDown: () => (m.pitch = Math.min(MAX_PITCH, m.pitch + step)),
      ' ': () => (this.#playing ? this.pause() : this.play()),
    };
    if (this.hasAttribute('zoomable')) {
      moves['+'] = moves['='] = () => this.#setZoom(this.#zoom * 1.1);
      moves['-'] = () => this.#setZoom(this.#zoom / 1.1);
    }
    const f = moves[e.key];
    if (!f) return;
    e.preventDefault();
    f();
    this.#dirty = true;
    this.#kick();
  };

  #onWheel = (e: WheelEvent) => {
    if (!this.hasAttribute('zoomable') || !this.#renderer) return;
    e.preventDefault();
    this.#setZoom(this.#zoom * Math.exp(-e.deltaY * 0.001));
  };

  #setZoom(z: number) {
    this.#zoom = Math.max(0.3, Math.min(4, z));
    this.#restyle();
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('textel-viewer')) customElements.define('textel-viewer', TextelViewer);

declare global {
  interface HTMLElementTagNameMap {
    'textel-viewer': TextelViewer;
  }
}
