// Terminal playback for Node: a full-screen session with clean restore, and players for frames files.
// `textel/terminal` in the package.
import { readFileSync } from 'node:fs';
import { RESET, type ColorDepth } from './ansi.ts';
import { parseFrames, recordingANSI, recordingText, type Recording } from './frames.ts';

const CSI = '\x1b[';

/** What the players need from an output stream; `process.stdout` is one. */
export interface TerminalOutput {
  write(s: string): unknown;
  on(event: 'resize', listener: () => void): unknown;
  off(event: 'resize', listener: () => void): unknown;
  isTTY?: boolean;
  columns?: number;
  rows?: number;
}

/** What the players need from an input stream; `process.stdin` is one. */
export interface TerminalInput {
  on(event: 'data', listener: (key: string) => void): unknown;
  off(event: 'data', listener: (key: string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
  setEncoding(encoding: 'utf8'): unknown;
  isTTY?: boolean;
  setRawMode?(on: boolean): unknown;
}

type Out = TerminalOutput;
type In = TerminalInput;

/** What a stream can show, honoring NO_COLOR, FORCE_COLOR and COLORTERM. */
export function detectColorDepth(stream: Out = process.stdout, env: NodeJS.ProcessEnv = process.env): ColorDepth {
  if (env.NO_COLOR) return 'none';
  if (!stream.isTTY && !env.FORCE_COLOR) return 'none';
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' || env.WT_SESSION || env.TERM_PROGRAM === 'vscode' || env.TERM_PROGRAM === 'iTerm.app') return 'truecolor';
  return '256';
}

export interface ScreenOptions {
  output?: Out;
  /** keys arrive here when given; the input is put in raw mode */
  input?: In | null;
  onKey?: (key: string) => void;
  onResize?: () => void;
}

/**
 * A full-screen session: alternate screen, hidden cursor, raw keys. `close()` puts everything back,
 * and so does process exit, so a crash never leaves the terminal broken.
 */
export class Screen {
  readonly output: Out;
  private input: In | null;
  private closed = false;
  private keyHandler?: (k: string) => void;
  private resizeHandler?: () => void;
  private exitHandler = () => this.restore();

  constructor(opts: ScreenOptions = {}) {
    this.output = opts.output ?? process.stdout;
    this.input = opts.onKey ? opts.input ?? process.stdin : null;
    this.output.write(`${CSI}?1049h${CSI}?25l${CSI}2J`);
    process.on('exit', this.exitHandler);
    if (opts.onResize) {
      this.resizeHandler = () => { this.output.write(`${CSI}2J`); opts.onResize!(); };
      this.output.on('resize', this.resizeHandler);
    }
    if (this.input && opts.onKey) {
      this.keyHandler = opts.onKey;
      this.input.setRawMode?.(true);
      this.input.setEncoding('utf8');
      this.input.on('data', this.keyHandler);
      this.input.resume();
    }
  }

  get columns() { return this.output.columns ?? 80; }
  get rows() { return this.output.rows ?? 24; }

  /** draws lines from the top left; `status` goes on the last row, dimmed */
  draw(lines: string[], status?: string) {
    let s = `${CSI}H${lines.join(`${CSI}K\n`)}${CSI}K`;
    if (status !== undefined) {
      const w = this.columns;
      s += `${CSI}${this.rows};1H${CSI}2m${status.slice(0, w).padEnd(w)}${RESET}`;
    }
    this.output.write(s);
  }

  private restore() {
    if (this.closed) return;
    this.closed = true;
    this.output.write(`${RESET}${CSI}?25h${CSI}?1049l`);
    if (this.input) {
      if (this.keyHandler) this.input.off('data', this.keyHandler);
      this.input.setRawMode?.(false);
      this.input.pause();
    }
    if (this.resizeHandler) this.output.off('resize', this.resizeHandler);
  }

  close() {
    this.restore();
    process.off('exit', this.exitHandler);
  }
}

export type PlayResult = 'end' | 'quit' | 'interrupt' | 'abort';

export interface PlayOptions {
  output?: Out;
  input?: In | null;
  /** keys: space pause, ←/→ step a frame, +/- speed, q quit (default false) */
  interactive?: boolean;
  /** keep looping until stopped (default true) */
  loop?: boolean;
  /** stop after this long */
  seconds?: number;
  signal?: AbortSignal;
  /** default: detected from the output */
  depth?: ColorDepth;
  /** playback rate; default the file's */
  fps?: number;
  /** a status line at the bottom (default: on when interactive) */
  status?: boolean;
  /** shown in the status line */
  title?: string;
}

/**
 * Plays a recording full screen. Resolves when it ends, the user quits, Ctrl+C is pressed or the
 * signal aborts; the terminal is restored in every case. On output that is not a terminal it prints
 * the first frame and returns.
 */
export function play(rec: Recording, opts: PlayOptions = {}): Promise<PlayResult> {
  const output = opts.output ?? process.stdout;
  const depth = opts.depth ?? detectColorDepth(output);
  if (!output.isTTY) {
    output.write((depth === 'none' ? recordingText(rec, 0) : recordingANSI(rec, 0, depth).join('\n')) + '\n');
    return Promise.resolve('end');
  }
  const n = rec.frames.length, baseFps = opts.fps ?? rec.fps, loop = opts.loop ?? true;
  const interactive = !!opts.interactive, showStatus = opts.status ?? interactive;

  return new Promise<PlayResult>((resolvePlay) => {
    let pos = 0, speed = 1, paused = false, last = performance.now(), elapsed = 0, done = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const finish = (r: PlayResult) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      process.off('SIGINT', onSigint);
      screen.close();
      resolvePlay(r);
    };
    const onAbort = () => finish('abort');
    const onSigint = () => finish('interrupt');

    const screen = new Screen({
      output,
      input: opts.input,
      onResize: () => draw(),
      onKey: interactive || opts.input ? (key) => {
        // without controls, any key ends playback (a splash screen can be skipped)
        if (!interactive) return finish(key === '\x03' ? 'interrupt' : 'quit');
        switch (key) {
          case '\x03': finish('interrupt'); break;
          case 'q': case 'Q': case '\x1b': finish('quit'); break;
          case ' ': paused = !paused; break;
          case '\x1b[C': paused = true; pos = Math.floor(pos) + 1; draw(); break;
          case '\x1b[D': paused = true; pos = Math.floor(pos) - 1 + n; draw(); break;
          case '+': case '=': speed = Math.min(8, speed * 1.25); break;
          case '-': case '_': speed = Math.max(0.125, speed / 1.25); break;
        }
      } : undefined,
    });
    if (opts.signal?.aborted) return finish('abort');
    opts.signal?.addEventListener('abort', onAbort);
    process.on('SIGINT', onSigint);

    function draw() {
      const i = Math.floor(pos) % n;
      const lines = depth === 'none' ? recordingText(rec, i).split('\n') : recordingANSI(rec, i, depth);
      // center the grid; crop when the terminal is smaller
      const rows = screen.rows - (showStatus ? 1 : 0), cols = screen.columns;
      const top = Math.max(0, Math.floor((rows - rec.height) / 2)), left = Math.max(0, Math.floor((cols - rec.width) / 2));
      const pad = ' '.repeat(left);
      const shown = lines.slice(0, Math.max(0, rows - top)).map((l) => pad + l);
      const out = [...new Array(top).fill(''), ...shown];
      let status: string | undefined;
      if (showStatus) {
        const small = rec.width > cols || rec.height > rows ? ' · terminal too small, cropped' : '';
        status = ` ${opts.title ?? 'textel'} · frame ${i + 1}/${n} · ${(speed * baseFps).toFixed(0)}fps${paused ? ' · paused' : ''}${small}   space pause  ←→ step  +/- speed  q quit`;
      }
      screen.draw(out, status);
    }

    const tick = () => {
      const now = performance.now(), dt = Math.min(now - last, 100) / 1000;
      last = now;
      elapsed += dt;
      if (opts.seconds !== undefined && elapsed >= opts.seconds) return finish('end');
      if (!paused) {
        pos += dt * baseFps * speed;
        if (!loop && pos >= n) return finish('end');
      }
      draw();
    };
    draw();
    timer = setInterval(tick, 1000 / Math.max(1, Math.min(120, baseFps)));
  });
}

/** Reads a `.textel.json` file. */
export function loadFrames(file: string): Recording {
  return parseFrames(readFileSync(file, 'utf8'));
}

/**
 * A spinning logo for a few seconds, then back to the normal screen: for the start of another CLI.
 * Any key skips it. Does nothing visible when output is not a terminal.
 */
export async function playSplash(source: string | Recording, opts: { seconds?: number; output?: Out; input?: In | null } = {}): Promise<PlayResult> {
  const output = opts.output ?? process.stdout;
  if (!output.isTTY) return 'end';
  const rec = typeof source === 'string' ? loadFrames(source) : source;
  const input = opts.input === undefined ? (process.stdin.isTTY ? process.stdin : null) : opts.input;
  return play(rec, { output, input, seconds: opts.seconds ?? 2, interactive: false, status: false });
}
