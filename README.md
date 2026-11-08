# textel

Turn 3D models into animated ASCII art, in the terminal and on the web.

```
          /-----------------\
      /---/-----------------\----\
   /--//-------------------------\\--\
 ////-----%@@@@@@@@@@@@##########----||
/##%//%%%%@@@@@@@@@@@@@%############\|
\\***##%@@@@@@@@@@@@@@@@%#####*++++==|
  \\\**##############%%%%+==========//
    \-\\*###############*====://////
       \\\----------------///--///
         \\\----------------//-/
           \--\-----------///
              \-\------//-/
                \-\--///
                  \--/
```

```sh
npx textel model.glb                   # spins in your terminal
npx textel --example gem               # built-in scenes: donut, dice, rocket, planet, mug, gem
npx textel model.stl --once > art.txt  # one frame as plain text
```

Reads `.glb`, `.gltf`, `.obj` and `.stl`. Everything runs locally; nothing is uploaded.

## Terminal

```
textel <model> [options]       spin it in the terminal (same as textel preview)
textel render <model> [-o f]   record a spinning loop into a .textel.json file
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
import { playSplash } from 'textel/terminal';

await playSplash('logo.textel.json', { seconds: 2 }); // any key skips it
```

`play(recording, options)` from the same module gives full control: looping, keys, an
`AbortSignal`, the output stream. Both restore the terminal however playback ends, and print a single
frame when the output is not a terminal.

## On a web page

Record once, then play the file with `<textel-player>`: about 3 KB, no 3D code in the page.

```sh
textel render logo.glb --aspect 1.5 -o logo.textel.json
```

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/textel@0.2/dist/textel-player.js"></script>
<textel-player src="logo.textel.json"></textel-player>
```

Or from npm in a bundled app: `npm install textel`, then `import 'textel/player'`.

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

`npm run demo` serves a page with several players and a drop zone for your own files.

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

## Library

```ts
import { parseModel, createRenderer, toANSI, toHTML, toText } from 'textel';

const mesh = parseModel(bytes, 'model.glb');
const renderer = createRenderer(mesh, { width: 112, height: 56, aspect: 1.5, charset: 'hard' });

const frame = renderer.render({ yaw: 0.5 });
pre.innerHTML = toHTML(frame);            // browser
process.stdout.write(toANSI(frame).join('\n'));  // terminal
```

### Shapes in code

`textel/sdf` meshes signed distance fields, so a scene can be written as a function instead of modeled:

```ts
import { sdfToMesh, sdBox, sdSphere } from 'textel/sdf';

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
