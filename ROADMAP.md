# Roadmap

textel turns 3D models into animated ASCII art. One engine, four ways to use it:
the **CLI**, a lightweight **player**, a live **viewer** for the web, and a **playground** site.
A single preset file describes the look and works the same everywhere.

Each milestone ends with something people can use. Versions before 1.0 may change the API.

## Principles

1. **One engine.** Every surface (CLI, player, viewer, playground, exports) renders through the same core,
   so a preset gives the same picture everywhere.
2. **Local only.** Models never leave the user's machine or browser. No server, no accounts.
3. **Small at runtime.** The core has no dependencies. The player is a few KB. Heavy tools
   (GIF/MP4 encoding) are optional and never pulled in by the runtime.
4. **Good defaults.** Any model should look good with zero options; every option is still reachable.
5. **Well behaved on the web.** Pause off screen, honor reduced motion, never block input, accessible labels.

---

## Where things stand (November 2026)

0.1 through 0.5 are done. textel works today as a **terminal tool, a library for
Node, a web player, a live web viewer and a playground site** that exports SVG, GIF, MP4, PNG and HTML,
published on npm as `@feelgxxd/textel` and
at [feelgxxd.github.io/textel](https://feelgxxd.github.io/textel/).

| | |
|---|---|
| Code | ~3,300 lines of TypeScript in `src`, no runtime dependencies |
| Tests | 88 (loaders, meshing, rendering, frames format, terminal player, CLI, web player and viewer in happy-dom, playground share links and exports, animated SVG, GIF and MP4 writers, 10 golden-frame snapshots) |
| CI | green on Windows, macOS, Linux × Node 22, 24 |
| Render speed | 1.7–3.7 ms per frame at 160×50 for the examples (53k–113k triangles) |
| Page update | under 1 ms per frame without color, 3.6 ms with a gradient at 160×80 (desktop Chrome) |
| Web sizes | player 3.2 KB, viewer 11 KB, playground 19 KB (min+gzip) |
| Published | `0.5.0` on npm; the playground deploys from `main` |

### What works
- `textel <model>` spins a `.glb` / `.gltf` / `.obj` / `.stl` in the terminal, with keys for rotation,
  zoom, charset, edges, light; `--once` prints one frame; presets and style flags
- `textel render` records a loop into a `.textel.json` file; `textel play` plays it (pause, step, speed)
- `textel list`, `textel help <command>`
- Library: `parseModel`, `createRenderer`, `toText` / `toANSI` / `toHTML`, `@feelgxxd/textel/sdf`,
  `recordLoop` / `stringifyFrames` / `parseFrames`, `@feelgxxd/textel/terminal` (`play`, `playSplash`),
  `parseModelAsync`
- Web: `<textel-player>` plays recorded loops; `<textel-viewer>` renders models live and lets people turn them
- Playground: load a model or an example, tune the look live, share it as a link, export embeds,
  recorded loops, CLI commands and presets
- Built-in examples: donut, dice, rocket, planet, mug, gem

### Known issues and debt
| Item | Effect | Planned in |
|---|---|---|
| Live preview keys (`live.ts`) are only tested by hand; the screen and player under them are tested with fake streams | a key handling regression in preview would only show by hand | any time |
| Checked by hand in desktop Chrome and one phone browser only | Safari, Firefox and other phones may differ | 1.0 |
| Examples `rocket` and `mug` read less clearly than the others | weaker first impression | any time |
| Draco / meshopt glTF rejected; flat shading when a model has no normals | some real files look worse or do not load | 1.0 |

---

## 0.2.3 `textel render` and `textel play` ✅

Turns the frames format into something people use from the terminal.

### `textel render`
- [x] `textel render <model|--example> -o out.textel.json` with every style flag from preview
- [x] `--frames <n>` (default 120), `--fps <n>` (default 30), `--turns <n>` (default 1, negative reverses),
  `--size WxH` (default 112×56), `--aspect` (default 2; use the target font's value for the web)
- [x] Without `-o`: write `<model name>.textel.json` next to the current directory; refuse to overwrite without `--force`
- [x] Progress on stderr while rendering; at the end the frame count, file size and gzip size
- [x] `meta`: title (model or example name), textel version, render settings, so a file can be re-rendered

### `textel play`
- [x] `textel play <file.textel.json>` full screen, looping, same alternate-screen handling as preview
- [x] Keys: `space` pause, `←/→` step a frame (scrub), `+/-` speed, `q` quit
- [x] Centers the grid if the terminal is bigger, warns once if it is smaller
- [x] `--once` prints one frame (`--frame <n>`), useful in scripts and for tests

### `@feelgxxd/textel/terminal` (library)
- [x] `play(recording, { output, input, loop, seconds, signal })` returns a promise; used by `textel play` itself
- [x] `playSplash(file, { seconds = 2 })`: shows a spinning logo in another CLI, then restores the screen
- [x] Respects `NO_COLOR`, non-TTY output (prints one frame instead) and Ctrl+C

### Cleanup
- [x] One shared ANSI color module for `output.ts`, `frames.ts` and the players
- [x] Shared loop and screen code for preview and play (`Screen` in `src/terminal.ts`)
- [x] CLI tests that spawn the CLI: `render` → file exists and parses; `play --once` prints the same
  text as `preview --once` for the same settings

**Done when** `textel render` + `textel play` work on all three CI platforms and a frame from `play`
matches the frame `preview` draws for the same settings.

---

## 0.2.4 `<textel-player>` for the web ✅

The first thing that runs in a browser.

### Build
- [x] esbuild as a dev dependency; `npm run build` emits `dist/textel-player.js` (ES module, minified, one file)
- [x] Package export `@feelgxxd/textel/player`; the same file works from a CDN
- [x] Size check: the build fails above 5 KB min+gzip (currently **3.2 KB**); `npm run size` checks without building

### Element
- [x] `<textel-player src="logo.textel.json">` custom element in a shadow root; or `.recording = json` from JS
- [x] Attributes: `src`, `fps`, `paused`, `nodrag` (drag scrubs by default), `color`, `label`
- [x] Plain text for colorless files, `<span>`s only when the file has styles; markup cached per frame
- [x] Fits its box with a transform, and stretches the font's cells to the aspect the file was rendered for,
  so proportions hold in any font; height follows from the width unless the box sets one
- [x] CSS hooks: `font-family`, `color`, `--textel-dim-opacity`, `--textel-glow`, `::part(screen)`
- [x] Runs only while playing, on screen and in a visible tab; frame-rate independent timing
- [x] `prefers-reduced-motion`: starts paused, drag still works
- [x] `role="img"` and `aria-label`; `load` and `error` events
- [x] Decoding uses one byte per cell when the palettes fit (half the memory); the format code moved to
  `src/format.ts` with no dependencies, so the player carries no renderer code

### Tests and demo
- [x] Tests for the DOM-free logic: markup, escaping, timing, scrubbing, fit, labels
- [x] DOM tests for the element in happy-dom: drawing, styles, play / pause / frame, drag and `nodrag`, `src` with `load` / `error`
- [x] `examples/player.html` + `npm run demo`: five players with different looks, fonts and attributes,
  and a drop zone for your own files

**Done when** a file from `textel render` plays the same in `textel play` and `<textel-player>`, and the
player is under 5 KB.

**Release point**: `v0.2.0`, the first public version. Checked by hand in a desktop browser; see CHANGELOG.md.

---

## 0.3: live viewer ✅

- [x] `<textel-viewer src="model.glb" preset="look.json">` web component on top of the core
- [x] **Accurate aspect**: measures the page font's cell in a hidden `<pre>` and renders for that shape,
  so nothing is stretched; re-measures on font load and resize
- [x] **Interaction**: drag on both axes with a flick that eases back to the resting spin and tilt;
  arrow keys and space when focused; wheel and `+` / `-` zoom with `zoomable`
- [ ] Pinch zoom on touch screens (wheel only so far)
- [x] **No blocking**: measured first. Binary glTF parses in a few ms even at 10 MB; the real cost was
  large text `.obj` files (120 ms for 7 MB). Parsing in slices (`parseModelAsync`) brought the longest
  freeze to ~20 ms with no Web Worker, so no extra bundle and no trouble with strict CSP
- [x] **Output path**: measured in Chrome (`/bench` in the demo). Colorless frames cost under 1 ms
  whichever way; colored frames were slow because nearly every cell had its own color span. One color
  per glyph level cut a 160×80 gradient frame from 13 ms to 3.6 ms. Per-row updates and CSS classes
  gained only 5–7 %, so the viewer keeps whole-frame `innerHTML` (colored) and `textContent` (plain)
- [ ] The same benchmark on a phone
- [x] **API**: `load(url | File | bytes)`, `mesh`, `look`, `play()`, `pause()`, `paused`; attributes for
  the common preset fields; `load` and `error` events
- [x] Same visibility, reduced-motion, accessibility and fit behavior as the player
- [x] Fit while dragging: `fitPitch` keeps the model inside the grid for any allowed tilt
- [x] Size budget: viewer + core + loaders **11 KB** min+gzip, budget 12 KB, checked by the build
- [ ] Faster `dice` field, or examples shipped pre-meshed: moved to 0.4, where the playground needs them

**Done when** the viewer can be dropped into a plain HTML page with one script tag and feels smooth.
Checked by hand in desktop Chrome; a phone check is still open.

---

## 0.4: playground (GitHub Pages) ✅

Built with Vite and plain TypeScript, using the viewer itself, so the site is also the viewer's test bench.
Live at [feelgxxd.github.io/textel](https://feelgxxd.github.io/textel/).

- [x] **Input**: drag and drop or file picker (`.glb`, `.gltf` + `.bin`, `.obj`, `.stl`), or pick an example;
  warn above ~500k triangles
- [x] **Look panels**: charset (named or custom), color mode (none / mono / gradient), light (around and
  height sliders), ambient, edges, shading
- [x] **Camera and motion**: pitch, spin speed, zoom, distance (perspective), grid size
- [x] **Materials**: list the model's material names, map each to solid / carved / dim / custom
- [x] **Preset gallery**: plain, terminal green, amber CRT, blueprint, ink on paper, blocks
- [x] **Share**: the whole look compressed into the URL hash; opening the link restores it
  (the model itself is never in the URL; an example is, by name)
- [x] **Export**: preset JSON, recorded `.textel.json` loop, embed snippet (player or viewer), equivalent CLI command
- [x] Narrow layout: preview on top, panels below
- [x] Deployed from `main` by GitHub Actions to GitHub Pages; CI checks that the built site defines the viewer
- [x] Examples load fast: `dice` meshes in under 0.2 s instead of 0.8 s
- [x] Pinch zoom in the viewer
- [x] Checked on a real phone: touch turning, pinch zoom, the panels
- [ ] Nice to have, moved to the backlog: a live ramp preview next to the charset, a light handle on a sphere,
  an aspect control

**Done when** someone with no tooling can go from a `.glb` to an embed snippet in under a minute.

---

## 0.5: exports ✅

Effort: **two sessions**.

- [x] **Animated SVG**: one `<text>` per row per frame, stepped with CSS animation; works inside GitHub
  READMEs where scripts do not run. 80×40 × 80 frames at 20 fps is ~290 KB (24 KB gzipped) without color; the
  playground makes it at that size, the CLI at any size. The README shows one
- [x] **GIF and MP4** in the playground: canvas, an own GIF encoder (only changed pixels per frame) and an
  own MP4 writer around WebCodecs H.264. 640×640 GIF ~600 KB, 1280×1280 MP4 ~1.4 MB for one 4 s turn
- [x] **Single frame**: PNG of the preview at its angle (playground, through the new `viewer.view`), plain
  text and ANSI (CLI, `--once`)
- [x] **Single-file HTML**: player and frames inlined, works offline (~450 KB); the player is bundled into the
  site at build time, so the file never depends on a CDN
- GIF and MP4 from the CLI: moved to the backlog; the playground makes both

---

## 1.0: release

Effort: **three to four sessions**, spread over the milestones above where possible.

### Quality
- [ ] Crease edges from normal discontinuities, not only silhouettes and depth steps
- [ ] Steadier glyphs while spinning: hysteresis on edge glyphs and ramp steps
- [ ] Model colors: vertex colors and material base color as a color mode
- [ ] Smooth shading for models without normals, with a crease angle so hard edges stay hard
- [ ] Large models: automatic decimation above a triangle budget
- [ ] Draco and meshopt compressed glTF

### API
- [ ] Review everything `src/index.ts` exports; mark internals as internal, freeze names and options
- [ ] Generated API reference from the doc comments

### Project
- [ ] Docs on the playground site: getting started, CLI reference, preset reference, API reference, format spec
- [ ] Terminal compatibility notes: Windows Terminal, conhost, macOS Terminal, iTerm2, GNOME Terminal, kitty, Alacritty
- [ ] CONTRIBUTING, code of conduct, issue and PR templates, CHANGELOG
- [ ] Semantic versioning from here on; the frames format keeps its own version
- [ ] Repo public (if not earlier) and `@feelgxxd/textel@1.0.0` on npm

---

## Could do (backlog)

Ideas that fit the project but are not on the path to 1.0. Value and effort are rough guesses.

| Idea | Value | Effort | Notes |
|---|---|---|---|
| Braille mode (2×4 dots per cell) | high | M | 8× the resolution; great for thin models |
| Playground extras: live ramp preview next to the charset, light handle on a sphere, aspect control | medium | S | left over from 0.4 |
| GIF and MP4 from the CLI | low | M | needs glyphs drawn without a browser: a bundled bitmap font that covers blocks and box drawing, or an optional add-on; the playground makes both today |
| Half-block mode (two colored "pixels" per cell) | high | M | reads like pixel art; needs color |
| Shape-matched glyphs | high | L | picks glyphs by the shape inside a cell, not only brightness; the biggest quality jump |
| Play the model's own glTF animations | high | L | skinning and morph targets; turntable stays the default |
| GitHub README badge / SVG service in the playground | high | M | the most likely way people discover textel |
| Text to 3D ASCII (extruded letters as an SDF) | medium | S | spinning logos from a word, no model needed |
| Image to height map to 3D | medium | M | a logo PNG becomes a relief |
| Toon lighting, rim light, several lights | medium | S | looks |
| CRT / scanline / glow effects for the web | medium | S | CSS only |
| React / Vue / Svelte wrappers | medium | S each | thin layers over the custom elements |
| Standalone binaries (no Node needed): Node SEA builds, then Homebrew / Scoop / winget | high | M | today the CLI needs Node 22+, the biggest hurdle for terminal-only users |
| `textel render --format ansi`: frames as plain ANSI text plus a tiny shell player | medium | S | lets Python, Go, Rust or shell scripts play a logo without any textel code |
| Binary `.textel` container | low | S | ~25% smaller; only if sizes become a complaint |
| Terminal screensaver mode (`textel screensaver`) | low | S | fun, cheap |
| Preset sharing gallery | medium | L | needs a place to store presets; conflicts with "no server" unless it is a repo folder |

---

## Decisions

Made:

| Decision | Choice | Why |
|---|---|---|
| Frames container | JSON + base64 | sizes are well under target; readable, embeddable, compressed by static hosts |
| When to publish to npm | at 0.2.0 | claims the name and lets people try it; 0.x signals that the API may change |
| When to make the repo public | with the first npm release | npm pages link to the repo |
| Browser tests | happy-dom for the elements, Playwright later for the playground | fast tests in Node now; a real browser once there is a site |
| npm package name | `@feelgxxd/textel` | npm blocks unscoped `textel` as too similar to `testem`; a scope cannot be squatted |
| Default aspect for `textel render` | 2 (terminals) | the player stretches to the file's aspect in any font; `--aspect` documented for web use |
| Playground framework | plain TypeScript with Vite | the site is small and uses the custom elements |
| Playground address | the GitHub Pages URL, `feelgxxd.github.io/textel` | works with no setup; a custom domain can come later |
| Example loading | keep building them from code, make the slow field faster | shipped meshes would be about 1.5 MB each |

---

## Cross-cutting

| Area | Plan |
|---|---|
| Testing | unit tests for loaders, format and math; golden-frame snapshots for visuals; CLI tests via the built CLI; DOM tests for the elements; size budget checks in CI |
| Performance | track ms per frame for each example at 112×56 and 160×50 in a bench script; flag regressions |
| Compatibility | Node 22+; evergreen browsers; terminals listed above |
| Bundle sizes | player < 5 KB, viewer < 25 KB (min+gzip), checked in CI |
| Versions | `package.json` follows the milestones (0.2.0 at the player); git tag per release; CHANGELOG from 0.2.0 |

## Risks

| Risk | Mitigation |
|---|---|
| Frames files too big for casual embeds | measured: well under target; fewer frames or smaller grids as presets; binary container in reserve |
| Glyph aspect differs per font and platform | measure in the browser; `--aspect` in the terminal; document common values |
| Huge or odd models (millions of triangles, broken normals) | triangle budget with decimation; two-sided lighting is already in place |
| Terminals handle fast redraws differently | redraw only changed rows; cap fps; compatibility notes |
| Viewer bundle over budget | keep examples and SDF out of it; measure minified early in 0.3 |
| The package name | npm refused unscoped `textel` as too close to `testem`; the scope `@feelgxxd/textel` is ours, and the command is still `textel` |
| Scope creep before a first release | the 1.0 list is the bar; everything else waits in "Could do" |

## Next session starts with

1. 1.0: choose the order: quality first (crease edges, steadier glyphs while spinning, model colors) or
   the API review that freezes names and options
2. Docs on the playground site
