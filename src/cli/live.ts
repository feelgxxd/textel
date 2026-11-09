import type { Mesh } from '../mesh.ts';
import { toANSI, type ColorDepth } from '../output.ts';
import { createRenderer } from '../render.ts';
import { CHARSETS, mergeStyles, resolveStyle, type EdgeMode, type StyleInput } from '../style.ts';
import { Screen } from '../terminal.ts';

export interface LiveOptions {
  mesh: Mesh;
  name: string;
  style: StyleInput;
  fixedSize: [number, number] | null;
  depth: ColorDepth;
  fps: number;
}

const EDGE_MODES: EdgeMode[] = [false, 'outline', 'depth', 'crease'];

/** Full-screen live rendering in the terminal until q / Ctrl+C. */
export function live(opts: LiveOptions) {
  const base = resolveStyle(opts.style);
  let screen: Screen;
  const size = (): [number, number] => opts.fixedSize ?? [Math.max(10, screen.columns), Math.max(5, screen.rows - 1)];

  const charsets = Object.keys(CHARSETS);
  const initialCharset = opts.style.chars !== undefined ? 'custom' : opts.style.charset ?? 'classic';
  let charsetName = initialCharset;
  let edgeMode = EDGE_MODES.indexOf(base.edges);
  let yaw = 0, pitchOffset = 0, zoom = base.zoom, light = 0, paused = base.spin === 0;
  const spin = base.spin || 0.66;
  let fps = 0, frames = 0, acc = 0, last = performance.now();
  let timer: ReturnType<typeof setInterval> | undefined;

  const quit = (code = 0) => {
    clearInterval(timer);
    screen.close();
    process.exit(code);
  };

  const onKey = (key: string) => {
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
        charsetName = initialCharset;
        renderer.setStyle({ ...opts.style, zoom, light: base.light, edges: base.edges });
        break;
    }
  };

  screen = new Screen({
    onKey,
    onResize: () => {
      if (opts.fixedSize) return;
      const [w, h] = size();
      renderer.setStyle({ width: w, height: h });
    },
  });
  process.on('SIGTERM', () => quit());
  process.on('uncaughtException', (e) => { screen.close(); console.error(e); process.exit(1); });

  const [w0, h0] = size();
  const renderer = createRenderer(opts.mesh, mergeStyles(opts.style, { width: w0, height: h0 }));

  const tick = () => {
    const now = performance.now(), dt = Math.min(now - last, 100) / 1000;
    last = now;
    frames++; acc += dt;
    if (acc >= 0.5) { fps = Math.round(frames / acc); frames = 0; acc = 0; }
    if (!paused) yaw += spin * dt;
    const frame = renderer.render({ yaw, pitch: base.pitch + pitchOffset });
    const edge = EDGE_MODES[edgeMode] || 'off';
    screen.draw(
      toANSI(frame, opts.depth),
      ` ${opts.name} · ${frame.width}×${frame.height} · ${charsetName} · edges ${edge} · ${fps}fps${paused ? ' · paused' : ''}   ←→↑↓ rotate  +/- zoom  c chars  e edges  l light  space pause  r reset  q quit`,
    );
  };
  tick();
  timer = setInterval(tick, 1000 / Math.max(1, Math.min(120, opts.fps)));
}
