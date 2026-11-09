# textel

Turn 3D models into animated ASCII art, in the terminal and on the web.

<p align="center"><img src="docs/gem.svg" width="480" alt="A gem spinning, drawn in ASCII characters"></p>

<p align="center"><sub>An animated SVG made with <code>textel render --example gem --size 80x40 --frames 80 --fps 20 -o gem.svg</code></sub></p>

```sh
npx @feelgxxd/textel model.glb                   # spins in your terminal
npx @feelgxxd/textel --example gem               # built-in scenes: donut, dice, rocket, planet, mug, gem
npx @feelgxxd/textel model.stl --once > art.txt  # one frame as plain text
```

Install it once with `npm install -g @feelgxxd/textel` and the command is just `textel`. Needs Node 22 or newer.

Reads `.glb`, `.gltf`, `.obj` and `.stl`. Everything runs locally; nothing is uploaded.

## Playground

**[feelgxxd.github.io/textel](https://feelgxxd.github.io/textel/)**: drop a model into the page, tune the
look with a live preview, and take it with you. Nothing to install, and your files never leave the browser.

- Start from a preset (terminal green, amber CRT, blueprint, ink on paper, blocks) or build your own look:
  characters, color and gradients, outlines, shading, light, camera and motion, and per-material styles
- **Copy link** puts the whole look in the URL, so a link opens the same look (the model itself stays with you)
- Export it as a viewer embed for a page, a recorded `.textel.json` loop with a player embed, the matching
  `textel` command for the terminal, or a preset JSON file

## Terminal

```
textel <model> [options]       spin it in the terminal (same as textel preview)
textel render <model> [-o f]   record a spinning loop into a .textel.json file or an animated .svg
textel play <file>             play a recorded file
textel list                    built-in examples and charsets
textel help <command>          all options of a command

look
  -c, --chars <ramp|name>   charset name or a custom ramp, darkest first
  -p, --preset <file.json>  style file; flags override it
      --color <#hex>        one color; --color #301000,#ffb000 for a gradient
      --edges [depth]       outline the silhouette (and depth steps)
      --light <x,y,z>       direction toward the light
camera
      --pitch <rad>  --spin <rad/s>  --zoom <n>  --distance <n>
  -s, --size <WxH>   -a, --aspect <n>
output
      --once  --yaw <rad>  --fps <n>  --no-color
```

Keys while it runs: `←→↑↓` rotate, `+/-` zoom, `c` charset, `e` edges, `l` light, `space` pause, `r` reset, `q` quit.

### Recording and playing

```sh
textel render logo.glb --color "#301000,#ffb000"   # writes logo.textel.json (120 frames, 112x56)
textel play logo.textel.json                       # space pause, ←→ step, +/- speed, q quit
```

A frames file is played without the 3D renderer, so it is cheap to show anywhere.
The format is documented in [docs/format.md](docs/format.md).

### In your own CLI

```ts
import { playSplash } from '@feelgxxd/textel/terminal';

await playSplash('logo.textel.json', { seconds: 2 }); // any key skips it
```

`play(recording, options)` from the same module gives full control: looping, keys, an
`AbortSignal`, the output stream. Both restore the terminal however playback ends, and print a single
frame when the output is not a terminal.

## On a web page

Two elements, both without dependencies and both loaded with one script tag:

| | `<textel-player>` | `<textel-viewer>` |
|---|---|---|
| shows | a recorded loop (`.textel.json`) | the model itself, rendered live |
| size | about 3 KB | about 11 KB |
| dragging | scrubs through the loop | turns the model any way, with a flick |
| best for | a spinning logo | something people play with |

Where scripts cannot run, such as a GitHub README, use an animated SVG instead (see below).

### `<textel-player>`

Record once, then play the file: no 3D code in the page.

```sh
textel render logo.glb --aspect 1.5 -o logo.textel.json
```

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@feelgxxd/textel@0.5/dist/textel-player.js"></script>
<textel-player src="logo.textel.json"></textel-player>
```

Or from npm in a bundled app: `npm install @feelgxxd/textel`, then `import '@feelgxxd/textel/player'`.

It fills its width and keeps the proportions the file was rendered for, whatever the page font.
Drag sideways to scrub. It pauses off screen and in background tabs, shows a still frame when the
visitor prefers reduced motion, and is labeled for screen readers.

| attribute | |
|---|---|
| `src` | the `.textel.json` file |
| `fps` | playback rate; default from the file |
| `paused` | start paused |
| `nodrag` | turn off drag to scrub |
| `color` | default color for cells without one; otherwise the element's CSS `color` |
| `label` | accessible name; default from the file's title |

Style it with CSS: `font-family`, `color`, `--textel-glow` (a `text-shadow`), `--textel-dim-opacity`,
or `::part(screen)`. From JavaScript: `player.play()`, `player.pause()`, `player.frame`,
`player.recording = json`, and the `load` and `error` events.

### `<textel-viewer>`

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@feelgxxd/textel@0.5/dist/textel-viewer.js"></script>
<textel-viewer src="model.glb" charset="hard" color="#301000,#ffb000" edges></textel-viewer>
```

Or `import '@feelgxxd/textel/viewer'` in a bundled app.

It measures the page font and renders for its real cell shape, so the model is never squashed. The box
is square unless you give it a height. Drag in any direction and let go to flick it; it eases back to
its resting spin. When focused, the arrow keys turn it and space pauses. Large `.obj` files are parsed
in slices so the page keeps responding while they load. Like the player, it pauses off screen and in
background tabs and respects reduced motion.

| attribute | |
|---|---|
| `src` | a `.glb`, `.gltf` (external buffers are fetched too), `.obj` or `.stl` |
| `preset` | a preset JSON file (see [Presets](#presets)) |
| `charset`, `chars`, `color`, `edges`, `spin`, `pitch`, `zoom`, `distance`, `ambient` | the same as the preset fields; `color` takes a comma separated gradient |
| `cols` | grid width in characters (default 96) |
| `paused` | start without spinning |
| `nodrag` | turn off dragging |
| `zoomable` | wheel, pinch and `+` / `-` zoom; on touch screens it takes all touches, so the page does not scroll over it |
| `label` | accessible name |

A preset is applied first, then the attributes, then `viewer.look = { ... }` from JavaScript.
Also from JavaScript: `viewer.load(urlOrFileOrBytes)`, `viewer.mesh = mesh` (for example from
`@feelgxxd/textel/sdf`), `play()`, `pause()`, and the `load` and `error` events.

`npm run demo` serves both demo pages with drop zones for your own files, and an output benchmark.

### Animated SVG

An image that spins by itself, with no script: it plays in a GitHub README, in docs and anywhere else an
`<img>` goes. The one at the top of this page is one.

```sh
textel render logo.glb --size 80x40 --frames 80 --fps 20 -o logo.svg
```

```md
![logo](logo.svg)
```

Every frame is stored whole, so keep it small: 80×40 with 80 frames (one turn in 4 s) is about 290 KB
(24 KB gzipped) without color; a gradient makes it several times larger. Without colors of its own it is transparent and
its text follows the reader's light or dark theme. It shows a still frame to readers who prefer reduced
motion. The playground makes one from its **Image** tab, and the library from any recording with
`recordingSVG(recording, { color, background, cell })`.

### GIF and video

For chats and social posts, the playground's **Image** tab also makes a GIF (640×640, about 600 KB) and
an MP4 video (1280×1280, about 1.4 MB), both one turn in 4 seconds in the page colors. They are made in
your browser; the video needs a browser that can encode H.264 (current Chrome, Edge and Safari).
The same tab saves a PNG of the preview at the angle it shows.

### One HTML file

The **Recorded loop** tab also makes a single HTML file with the player and the frames inside (about
450 KB). It opens anywhere, from a disk, an email or a USB stick, with no internet.

### From JavaScript

`viewer.view` tells the camera as the viewer draws it, so the same picture can be rendered at any size:

```ts
const { yaw, pitch, zoom, fitPitch } = viewer.view;
const frame = createRenderer(mesh, { ...look, zoom, fitPitch, width: 160, height: 80 }).render({ yaw, pitch });
```

## Presets

A preset is the whole look in one JSON file. The same file works with the CLI and the library.

```json
{
  "charset": "hard",
  "color": ["#301000", "#ffb000"],
  "edges": "outline",
  "pitch": 0.2,
  "spin": 0.8,
  "light": [-0.3, 0.35, 0.88],
  "materials": { "Glass": "carved", "Trim": "dim" }
}
```

Materials are matched by the names in the model file:

| style | effect |
|---|---|
| `"solid"` | the normal ramp |
| `"carved"` | blank, but still hides what is behind it: holes, sockets, engravings |
| `"dim"` | lower intensity |
| `{ "chars": "...", "color": "#hex", "opacity": 0.5 }` | its own ramp and color |

Charsets: `classic`, `hard`, `detailed`, `blocks`, `dots`, `minimal`, or any string of your own.

A gradient gives each glyph of the ramp one color, so colors change only where glyphs do; that keeps
terminal output and web pages light. `"colorSteps": 0` makes it smooth instead, or set a number of steps.

## Library

```ts
import { parseModel, createRenderer, toANSI, toHTML, toText } from '@feelgxxd/textel';

const mesh = parseModel(bytes, 'model.glb');
const renderer = createRenderer(mesh, { width: 112, height: 56, aspect: 1.5, charset: 'hard' });

const frame = renderer.render({ yaw: 0.5 });
pre.innerHTML = toHTML(frame);            // browser
process.stdout.write(toANSI(frame).join('\n'));  // terminal
```

### Shapes in code

`@feelgxxd/textel/sdf` meshes signed distance fields, so a scene can be written as a function instead of modeled:

```ts
import { sdfToMesh, sdBox, sdSphere } from '@feelgxxd/textel/sdf';

const mesh = sdfToMesh(
  (x, y, z) => Math.max(sdBox(x, y, z, 1, 1, 1, 0.1), -sdSphere(x, y, z, 1.25)),
  { min: [-1.2, -1.2, -1.2], max: [1.2, 1.2, 1.2], step: 0.03 },
);
```

`sdfToMeshSteps` does the same as a generator, so a page can build big shapes in idle time.

## How it works

A small software rasterizer draws into a character grid. Each cell is sampled several times
(`supersample`); the cell takes the mean brightness of the samples that hit the model, and that
picks a glyph from the ramp. The grid is corrected for character cells being taller than wide
(`aspect`). Edge mode runs a Sobel filter over depth and draws `- / | \` along the outline, at the
angles those glyphs actually have in a cell of that shape.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## License

MIT
