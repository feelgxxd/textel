import { toANSI, toText } from '../../output.ts';
import { createRenderer } from '../../render.ts';
import { live } from '../live.ts';
import { colorDepth, fail, HELP_OPTIONS, INPUT_HELP, INPUT_OPTIONS, loadInput, missingTextures, num, parse, parseSize, STYLE_HELP, STYLE_OPTIONS, styleFrom, TEXTURE_NOTE } from '../shared.ts';

export const summary = 'spin a model in the terminal (the default command)';

export const HELP = `textel preview: spin a model in the terminal

usage
  textel [preview] <model> [options]
  textel [preview] --example <name> [options]

${INPUT_HELP}

${STYLE_HELP}

output
      --once                print one frame and exit (also when output is not a terminal)
      --yaw <rad>           rotation of that frame (default 0.6)
      --fps <n>             frame rate while it runs (default 30)

keys  ←→↑↓ rotate  +/- zoom  c chars  e edges  l light  space pause  r reset  q quit
`;

const OPTIONS = {
  ...INPUT_OPTIONS,
  ...STYLE_OPTIONS,
  ...HELP_OPTIONS,
  once: { type: 'boolean' },
  yaw: { type: 'string' },
  fps: { type: 'string' },
} as const;

export async function run(argv: string[]) {
  const { values: o, positionals } = parse(argv, OPTIONS);
  if (o.help) return void process.stdout.write(HELP);
  if (positionals.length > 1) fail(`unexpected argument "${positionals[1]}"`);
  const input = await loadInput(o, positionals);
  if (!input) return void process.stdout.write(HELP);

  const style = styleFrom(o, input.style);
  const depth = colorDepth(o['no-color']);
  const tty = !!process.stdout.isTTY;
  const untextured = missingTextures(input.mesh, style);

  if (o.once || !tty || !process.stdin.isTTY) {
    if (untextured) process.stderr.write(TEXTURE_NOTE);
    const [w, h] = style.width && style.height ? [style.width, style.height] : tty ? [process.stdout.columns, Math.max(5, process.stdout.rows - 1)] : [80, 40];
    let r;
    try { r = createRenderer(input.mesh, { ...style, width: w, height: h }); } catch (e) { fail((e as Error).message); }
    const frame = r.render({ yaw: num(o.yaw, '--yaw') ?? 0.6 });
    process.stdout.write((depth === 'none' ? toText(frame) : toANSI(frame, depth).join('\n')) + '\n');
    return;
  }

  // the live view takes over the screen, so the note goes in its status line
  live({ mesh: input.mesh, name: untextured ? `${input.name} · textures not read yet` : input.name, style, fixedSize: parseSize(o.size), depth, fps: num(o.fps, '--fps') ?? 30 });
}
