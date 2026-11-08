// <textel-player>: plays a .textel.json file. No dependencies; no 3D code.
//
//   <script type="module" src="https://cdn.jsdelivr.net/npm/@feelgxxd/textel@0.2/dist/textel-player.js"></script>
//   <textel-player src="logo.textel.json"></textel-player>
import { fromFramesFile, type FramesFile, type Recording } from '../format.ts';
import { accessibleLabel, advance, fit, frameMarkup, scrub, type Markup } from './player-core.ts';

const CSS = `:host{display:block;position:relative;overflow:hidden;aspect-ratio:var(--textel-ratio,auto);min-height:1px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
:host(:not([nodrag])){cursor:grab;touch-action:pan-y}
:host(:not([nodrag]):active){cursor:grabbing}
pre{position:absolute;left:50%;top:50%;margin:0;transform-origin:50% 50%;font:inherit;font-size:16px;line-height:1;letter-spacing:0;white-space:pre;color:inherit;text-shadow:var(--textel-glow,none);-webkit-text-size-adjust:none;text-size-adjust:none;user-select:none;pointer-events:none}
.d{opacity:var(--textel-dim-opacity,.6)}`;

// Lets the module load where there is no DOM (server rendering, type imports).
const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

export class TextelPlayer extends Base {
  static observedAttributes = ['src', 'fps', 'paused', 'color', 'label'];

  #rec: Recording | null = null;
  #markup: Markup[] = [];
  #pre!: HTMLPreElement;
  #pos = 0;
  #shown = -1;
  #playing = true;
  #visible = true;
  #raf = 0;
  #last = 0;
  #drag: { x: number; pos: number } | null = null;
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
    root.append(style, this.#pre);
    this.addEventListener('pointerdown', this.#onDown);
    this.addEventListener('pointermove', this.#onMove);
    this.addEventListener('pointerup', this.#onUp);
    this.addEventListener('pointercancel', this.#onUp);
  }

  connectedCallback() {
    this.setAttribute('role', 'img');
    this.#updateLabel();
    this.#playing = !this.hasAttribute('paused') && !this.#reduced;
    // both are optional: without them the player just keeps running and fits once
    if (typeof IntersectionObserver === 'function') {
      this.#io = new IntersectionObserver(([e]) => { this.#visible = e.isIntersecting; this.#kick(); });
      this.#io.observe(this);
    }
    if (typeof ResizeObserver === 'function') {
      this.#ro = new ResizeObserver(() => this.#fit());
      this.#ro.observe(this);
    }
    this.ownerDocument.addEventListener('visibilitychange', this.#kick);
    this.ownerDocument.fonts?.ready.then(() => this.#fit());
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
    if (name === 'src') { if (value) this.#fetch(value); }
    else if (name === 'paused') { value === null ? this.play() : this.pause(); }
    else if (name === 'color') this.#pre.style.color = value ?? '';
    else if (name === 'label') this.#updateLabel();
  }

  /** the loaded recording; set it directly to play one without a file */
  get recording(): Recording | null { return this.#rec; }
  set recording(rec: Recording | FramesFile | null) {
    this.#rec = rec && 'data' in rec ? fromFramesFile(rec) : (rec as Recording | null);
    this.#markup = [];
    this.#pos = 0;
    this.#shown = -1;
    this.#updateLabel();
    this.#draw();
    this.#fit();
    this.#kick();
  }

  /** current frame index */
  get frame(): number { return Math.floor(this.#pos); }
  set frame(i: number) {
    const n = this.#rec?.frames.length ?? 1;
    this.#pos = ((Math.floor(i) % n) + n) % n;
    this.#draw();
  }

  get paused(): boolean { return !this.#playing; }
  play() { this.#playing = true; this.#kick(); }
  pause() { this.#playing = false; this.#kick(); }

  async #fetch(src: string) {
    this.#load?.abort();
    const ac = (this.#load = new AbortController());
    try {
      const res = await fetch(src, { signal: ac.signal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${src}`);
      const file = await res.json();
      if (ac.signal.aborted) return;
      this.recording = fromFramesFile(file);
      this.dispatchEvent(new CustomEvent('load', { detail: { frames: this.#rec!.frames.length } }));
    } catch (error) {
      if (ac.signal.aborted) return;
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
    }
  }

  #updateLabel() {
    if (this.isConnected) this.setAttribute('aria-label', accessibleLabel(this.#rec, this.getAttribute('label')));
  }

  #fps() {
    const a = Number(this.getAttribute('fps'));
    return a > 0 ? a : this.#rec?.fps ?? 30;
  }

  #draw() {
    const rec = this.#rec;
    if (!rec) return;
    const i = Math.floor(this.#pos) % rec.frames.length;
    if (i === this.#shown) return;
    this.#shown = i;
    const m = (this.#markup[i] ??= frameMarkup(rec, i));
    if (m.html) this.#pre.innerHTML = m.content;
    else this.#pre.textContent = m.content;
  }

  #fit() {
    const rec = this.#rec;
    if (!rec) return;
    const pre = this.#pre, cellW = pre.offsetWidth / rec.width, cellH = pre.offsetHeight / rec.height;
    const f = fit(rec.width, rec.height, rec.aspect, cellW, cellH, this.clientWidth, this.clientHeight);
    this.style.setProperty('--textel-ratio', String(f.ratio));
    pre.style.transform = `translate(-50%,-50%) scale(${f.scale},${f.scale * f.stretchY})`;
  }

  /** runs the animation only while it is playing, on screen and in a visible tab */
  #kick = () => {
    const run = this.#playing && this.#visible && !this.ownerDocument.hidden && !!this.#rec && !this.#drag && this.isConnected;
    if (run && !this.#raf) {
      // the first tick only sets the clock: time is measured between frame timestamps alone,
      // never mixed with performance.now(), whose reading can be later than the next frame's
      this.#last = -1;
      this.#raf = requestAnimationFrame(this.#tick);
    } else if (!run && this.#raf) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
  };

  #tick = (now: number) => {
    const rec = this.#rec!;
    if (this.#last >= 0) this.#pos = advance(this.#pos, (now - this.#last) / 1000, this.#fps(), rec.frames.length);
    this.#last = now;
    this.#draw();
    this.#raf = requestAnimationFrame(this.#tick);
  };

  #onDown = (e: PointerEvent) => {
    if (this.hasAttribute('nodrag') || !this.#rec || e.button !== 0) return;
    this.#drag = { x: e.clientX, pos: this.#pos };
    this.setPointerCapture(e.pointerId);
    this.#kick();
  };

  #onMove = (e: PointerEvent) => {
    if (!this.#drag || !this.#rec) return;
    this.#pos = scrub(this.#drag.pos, e.clientX - this.#drag.x, this.clientWidth, this.#rec.frames.length);
    this.#draw();
  };

  #onUp = () => {
    if (!this.#drag) return;
    this.#drag = null;
    this.#kick();
  };
}

if (typeof customElements !== 'undefined' && !customElements.get('textel-player')) customElements.define('textel-player', TextelPlayer);

declare global {
  interface HTMLElementTagNameMap {
    'textel-player': TextelPlayer;
  }
}
