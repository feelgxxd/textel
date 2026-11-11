#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import * as list from './commands/list.ts';
import * as play from './commands/play.ts';
import * as preview from './commands/preview.ts';
import * as render from './commands/render.ts';
import { fail } from './shared.ts';

interface Command {
  summary: string;
  HELP: string;
  run(argv: string[]): void | Promise<void>;
}

const COMMANDS: Record<string, Command> = { preview, render, play, list };

const HELP = `textel: 3D models as animated ASCII art

usage
  textel <model> [options]       spin it in the terminal (same as textel preview)
  textel <command> [options]

commands
${Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(10)} ${c.summary}`).join('\n')}
  help       help for a command: textel help preview

  -v, --version
  -h, --help

examples
  textel model.glb
  textel --example gem --color "#301000,#ffb000"
  textel render logo.glb -o logo.textel.json
  textel play logo.textel.json
  textel model.stl --once --size 80x40 > art.txt
`;

function version(): string {
  return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
}

function main(argv: string[]) {
  const [first, ...rest] = argv;
  if (first === undefined || first === '-h' || first === '--help') return void process.stdout.write(HELP);
  if (first === '-v' || first === '--version') return void process.stdout.write(version() + '\n');
  if (first === 'help') {
    if (!rest[0]) return void process.stdout.write(HELP);
    const c = COMMANDS[rest[0]] ?? fail(`no command "${rest[0]}" (have: ${Object.keys(COMMANDS).join(', ')})`);
    return void process.stdout.write(c.HELP);
  }
  const command = COMMANDS[first];
  if (command) return command.run(rest);
  // anything else is a model path or preview flags
  preview.run(argv);
}

// a reader that stops early (| head) closes the pipe: that is a normal end, not a crash
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

main(process.argv.slice(2));
