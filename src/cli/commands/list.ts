import { EXAMPLES } from '../../examples.ts';
import { CHARSETS } from '../../style.ts';
import { HELP_OPTIONS, parse } from '../shared.ts';

export const summary = 'built-in examples and charsets';

export const HELP = `textel list: built-in examples and charsets

usage
  textel list
`;

export function run(argv: string[]) {
  const { values: o } = parse(argv, HELP_OPTIONS);
  if (o.help) return void process.stdout.write(HELP);
  const out: string[] = ['examples'];
  for (const e of EXAMPLES) out.push(`  ${e.name.padEnd(10)} ${e.description}`);
  out.push('', 'charsets');
  for (const [k, v] of Object.entries(CHARSETS)) out.push(`  ${k.padEnd(10)} ${JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v)}`);
  process.stdout.write(out.join('\n') + '\n');
}
