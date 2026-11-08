import type { Mesh } from '../mesh.ts';
import { toANSI, type ColorDepth } from '../output.ts';
import { createRenderer } from '../render.ts';
import { CHARSETS, mergeStyles, resolveStyle, type EdgeMode, type StyleInput } from '../style.ts';

export interface LiveOptions {
  mesh: Mesh;
  name: string;
  style: StyleInput;
  fixedSize: [number, number] | null;
  depth: ColorDepth;
  fps: number;
}

const CSI = '\x1b[';
const EDGE_MODES: EdgeMode[] = [false, 'outline', 'depth'];

/** Full-screen animation in the terminal until q / Ctrl+C. */
export function live(opts: LiveOptions) {
  const out = process.stdout, inp = process.stdin;
  const base = resolveStyle(opts.style);
  const size = (): [number, number] => opts.fixedSize ?? [Math.max(10, out.columns), Math.max(5, out.rows - 1)];
  let [w, h] = size();
  const renderer = createRenderer(opts.mesh, mergeStyles(opts.style, { width: w, height: h }));

  const charsets = Object.keys(CHARSETS);
  let charsetName = opts.style.chars !== undefined ? 'custom' : opts.style.charset ?? 'classic';
  let edgeMode = EDGE_MODES.indexOf(base.edges);
  let yaw = 0, pitchOffset = 0, zoom = base.zoom, light = 0, paused = base.spin === 0;
  const spin = base.spin || 0.66;
  let fps = 0, frames = 0, acc = 0, last = performance.now();

  const restore = () => {
    out.write(`${CSI}0m${CSI}?25h${CSI}?1049l`);
    if (inp.isTTY) inp.setRawMode(false);
  };
  const quit = () => { restore(); process.exit(0); };
  process.on('exit', restore);
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  process.on('uncaughtException', (e) => { restore(); console.error(e); process.exit(1); });

  // alternate screen, hidden cursor
  out.write(`${CSI}?1049h${CSI}?25l${CSI}2J`);
  out.on('resize', () => {
    if (opts.fixedSize) return;
    [w, h] = size();
    renderer.setStyle({ width: w, height: h });
    out.write(`${CSI}2J`);
  });

  inp.setRawMode(true);
  inp.resume();
  inp.setEncoding('utf8');
  inp.on('data', (key: string) => {
    switch (key) {
      case 'q': case 'Q': case '\x03': case '\x1b': quit(); break;
      case ' ': paused = !paused; break;
      case '\x1b[C': yaw += 0.2; break;
      case '\x1b[D': yaw -= 0.2; break;
      case '\x1b[A': pitchOffset -= 0.15; break;
      case '\x1b[B': pitchOffset += 0.15; break;
      case '+': case '=': zoom *= 1.1; renderer.setStyle({ zoom }); break;
      case '-': case '_': zoom /= 1.1; renderer.setStyle({ zoom }); break;
      case 'c': {
        const i = charsets.indexOf(charsetName);
        charsetName = charsets[(i + 1) % charsets.length];
        renderer.setStyle({ charset: charsetName, chars: undefined });
        break;
      }
      case 'e':
        edgeMode = (edgeMode + 1) % EDGE_MODES.length;
        renderer.setStyle({ edges: EDGE_MODES[edgeMode] });
        break;
      case 'l': {
        // swing the light around the model in 45° steps
        light = (light + 1) % 8;
        const a = (light * Math.PI) / 4, [lx, ly, lz] = base.light;
        renderer.setStyle({ light: [lx * Math.cos(a) + lz * Math.sin(a), ly, -lx * Math.sin(a) + lz * Math.cos(a)] });
        break;
      }
      case 'r':
        yaw = 0; pitchOffset = 0; zoom = base.zoom; light = 0; edgeMode = EDGE_MODES.indexOf(base.edges);
        charsetName = opts.style.chars !== undefined ? 'custom' : opts.style.charset ?? 'classic';
        renderer.setStyle({ ...opts.style, zoom, light: base.light, edges: base.edges });
        break;
    }
  });

  const tick = () => {
    const now = performance.now(), dt = Math.min(now - last, 100) / 1000;
    last = now;
    frames++; acc += dt;
    if (acc >= 0.5) { fps = Math.round(frames / acc); frames = 0; acc = 0; }
    if (!paused) yaw += spin * dt;
    const frame = renderer.render({ yaw, pitch: base.pitch + pitchOffset });
    const lines = toANSI(frame, opts.depth);
    const edge = EDGE_MODES[edgeMode] || 'off';
    let status = ` ${opts.name} · ${frame.width}×${frame.height} · ${charsetName} · edges ${edge} · ${fps}fps${paused ? ' · paused' : ''}   ←→↑↓ rotate  +/- zoom  c chars  e edges  l light  space pause  r reset  q quit`;
    status = status.slice(0, w).padEnd(w);
    out.write(`${CSI}H${lines.join('\n')}\n${CSI}2m${status}${CSI}0m`);
  };
  tick();
  setInterval(tick, 1000 / Math.max(1, Math.min(120, opts.fps)));
}
