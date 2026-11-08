import { basename, resolve } from 'node:path';
import { recordingANSI, recordingText } from '../../frames.ts';
import { loadFrames, play } from '../../terminal.ts';
import { colorDepth, fail, HELP_OPTIONS, num, parse } from '../shared.ts';

export const summary = 'play a .textel.json file in the terminal';

export const HELP = `textel play: play a .textel.json file in the terminal

usage
  textel play <file.textel.json> [options]

options
      --once                print one frame and exit (also when output is not a terminal)
      --frame <n>           which frame --once prints (default 0)
      --fps <n>             playback rate (default: the file's)
      --seconds <n>         stop after this long
      --no-color            plain characters

keys  space pause  ←→ step a frame  +/- speed  q quit
`;

const OPTIONS = {
  ...HELP_OPTIONS,
  once: { type: 'boolean' },
  frame: { type: 'string' },
  fps: { type: 'string' },
  seconds: { type: 'string' },
  'no-color': { type: 'boolean' },
} as const;

export async function run(argv: string[]) {
  const { values: o, positionals } = parse(argv, OPTIONS);
  if (o.help || !positionals[0]) return void process.stdout.write(HELP);
  if (positionals.length > 1) fail(`unexpected argument "${positionals[1]}"`);
  const file = resolve(positionals[0]);
  let rec;
  try { rec = loadFrames(file); } catch (e) {
    const err = e as NodeJS.ErrnoException;
    fail(err.code === 'ENOENT' ? `cannot read ${positionals[0]}` : `${basename(file)}: ${err.message}`);
  }
  const depth = colorDepth(o['no-color']);

  if (o.once || !process.stdout.isTTY || !process.stdin.isTTY) {
    const i = num(o.frame, '--frame') ?? 0;
    if (!(Number.isInteger(i) && i >= 0 && i < rec.frames.length)) fail(`--frame is 0 to ${rec.frames.length - 1}`);
    process.stdout.write((depth === 'none' ? recordingText(rec, i) : recordingANSI(rec, i, depth).join('\n')) + '\n');
    return;
  }

  const title = typeof rec.meta.title === 'string' ? rec.meta.title : basename(file);
  const result = await play(rec, { interactive: true, depth, fps: num(o.fps, '--fps'), seconds: num(o.seconds, '--seconds'), title });
  if (result === 'interrupt') process.exitCode = 130;
}
