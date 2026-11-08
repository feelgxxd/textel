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

Four milestones are done: 0.1, 0.2.1, 0.2.2 and 0.2.3. textel works today as a **terminal tool and a library
for Node**; nothing runs in a browser yet, and nothing is published.

| | |
|---|---|
| Code | ~2,500 lines of TypeScript in `src`, no runtime dependencies |
| Tests | 50 (loaders, meshing, rendering, frames format, terminal player, CLI, 10 golden-frame snapshots) |
| CI | green on Windows, macOS, Linux × Node 22, 24 |
| Render speed | 1.7–3.7 ms per frame at 160×50 for the examples (53k–113k triangles) |
| Frames files | 120 frames at 112×56, gzipped: 47 KB average without color, 93 KB with a gradient |
| Core size | 22.8 KB gzip for all of `dist` except the CLI, unminified, examples and SDF included |
| Published | no: private repo, version `0.1.0` in `package.json`, no npm release, no tags |

### What works
- `textel <model>` spins a `.glb` / `.gltf` / `.obj` / `.stl` in the terminal, with keys for rotation,
  zoom, charset, edges, light; `--once` prints one frame; presets and style flags
- `textel render` records a loop into a `.textel.json` file; `textel play` plays it (pause, step, speed)
- `textel list`, `textel help <command>`
- Library: `parseModel`, `createRenderer`, `toText` / `toANSI` / `toHTML`, `textel/sdf`,
  `recordLoop` / `stringifyFrames` / `parseFrames`, `textel/terminal` (`play`, `playSplash`)
- Built-in examples: donut, dice, rocket, planet, mug, gem

### Known issues and debt
| Item | Effect | Planned in |
|---|---|---|
| Live preview keys (`live.ts`) are only tested by hand; the screen and player under them are tested with fake streams | a key handling regression in preview would only show by hand | any time |
| Decoded frames use two `Uint16Array`s per frame (~3 MB for 120 frames at 112×56) | heavy for the web player | 0.2.4 (`Uint8Array` when palettes fit, or decode on demand) |
| `dice` example takes ~0.8 s to mesh | slow start where it is built at runtime | 0.3 (faster field, or ship examples pre-meshed) |
| Fit uses the resting pitch only | dragging far up or down can clip the model | 0.3 |
| No browser build or browser tests | the web milestones need both | 0.2.4 |
| Core size is near the viewer budget before minifying | the 25 KB target is tight | 0.3 (measure minified, keep examples / SDF out of the viewer bundle) |
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

### `textel/terminal` (library)
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

## Next: 0.2.4 `<textel-player>` for the web

The first thing that runs in a browser. Effort: **one to two sessions**.

### Build
- [ ] esbuild as a dev dependency; `npm run build` emits `dist/browser/player.js` (ES module, minified)
- [ ] Package export `textel/player`, plus the single file for CDNs (`https://cdn.jsdelivr.net/npm/textel/...`)
- [ ] Size check in CI: fail above 5 KB min+gzip

### Element
- [ ] `<textel-player src="logo.textel.json">` custom element; or `.recording = ...` set from JS
- [ ] Attributes: `src`, `fps`, `autoplay` (default on), `drag` (horizontal drag scrubs the loop), `color`
  (default color for colorless files), `label` (overrides `meta.title`)
- [ ] Renders into one `<pre>`, one text node per row; styles as `<span>`s only when the file has them
- [ ] Scales the `<pre>` to fit its box (transform, so small fonts are not rounded by phone browsers)
- [ ] CSS hooks: `font`, `color`, `--textel-dim-opacity`, `--textel-glow`
- [ ] Pauses off screen (IntersectionObserver) and in hidden tabs; frame-rate independent timing
- [ ] `prefers-reduced-motion`: shows a still frame, drag still works
- [ ] `role="img"` and `aria-label`; `load` and `error` events

### Tests and demo
- [ ] Decoder tests already cover the format; add DOM tests for the element (happy-dom or a headless browser, see decisions)
- [ ] `examples/player.html`: a plain page that loads a few frames files; used by hand and in CI

**Done when** a file from `textel render` plays the same in `textel play` and `<textel-player>`, and the
player is under 5 KB.

**Release point**: tag `v0.2.0` here. This is the first version worth publishing (see decisions).

---

## 0.3: live viewer

Effort: **two to three sessions**.

- [ ] `<textel-viewer src="model.glb" preset="look.json">` web component on top of the core
- [ ] **Accurate aspect**: measure the glyph box of the page font in a hidden `<pre>` (width of N glyphs,
  line height), re-measure on font load and resize
- [ ] **Interaction**: drag to rotate on both axes, inertia that eases back to the resting spin,
  optional wheel / pinch zoom, keyboard arrows when focused
- [ ] **No blocking**: load and build models in a Web Worker (transfer the mesh buffers); SDF examples
  built in idle slices; render on the main thread (it is a few ms per frame)
- [ ] **Output path**: pick the faster of `innerHTML` per frame vs. updating one text node per row;
  measure on a low-end phone
- [ ] **API**: properties for every preset field, `load(url | File | ArrayBuffer)`, `play()`, `pause()`,
  `setStyle()`, events `load`, `error`, `frame`
- [ ] Same visibility, reduced-motion, accessibility and fit behavior as the player
- [ ] Fit while dragging: refit or clamp pitch so the model never clips
- [ ] Size budget: viewer + core + loaders < 25 KB min+gzip, without examples and SDF
- [ ] Faster `dice` field, or examples shipped pre-meshed for the web

**Done when** the viewer can be dropped into a plain HTML page with one script tag and
feels smooth at 60 fps on a mid-range phone with a 50k-triangle model.

---

## 0.4: playground (GitHub Pages)

Built with Vite and plain TypeScript, using the viewer itself, so the site is also the viewer's test bench.
Effort: **three to four sessions**.

- [ ] **Input**: drag and drop or file picker (`.glb`, `.gltf` + `.bin`, `.obj`, `.stl`), or pick an example;
  warn above ~500k triangles
- [ ] **Look panels**: charset (with a live ramp preview and custom input), color mode (none / mono / gradient
  editor), light (drag a handle on a sphere), ambient, edges, shading
- [ ] **Camera and motion**: pitch, spin speed, zoom, distance (perspective), grid size, aspect
- [ ] **Materials**: list the model's material names, map each to solid / carved / dim / custom
- [ ] **Preset gallery**: a handful of starting looks (terminal green, amber CRT, blueprint, ink on paper, blocks)
- [ ] **Share**: the whole preset compressed into the URL hash; opening the link restores it
  (the model itself is never in the URL)
- [ ] **Export**: preset JSON, frames file, embed snippet (player or viewer), equivalent CLI command
- [ ] Mobile layout: viewer on top, panels in a sheet below
- [ ] Deployed from `main` by GitHub Actions to GitHub Pages; custom domain optional later

**Done when** someone with no tooling can go from a `.glb` to an embed snippet in under a minute.

---

## 0.5: exports

Effort: **two sessions**.

- [ ] **Animated SVG**: one `<text>` per row per frame, stepped with CSS animation; works inside GitHub
  READMEs where scripts do not run. Size budget to be measured; offer fewer frames / smaller grids
- [ ] **GIF and MP4**: done in the playground with canvas (and WebCodecs for MP4 where available);
  from the CLI as an optional add-on so the main package stays dependency-free
- [ ] **Single frame**: PNG (playground), plain text and ANSI (CLI, already possible with `--once`)
- [ ] **Single-file HTML**: player and frames inlined, works offline

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
- [ ] Repo public (if not earlier) and `textel@1.0.0` on npm

---

## Could do (backlog)

Ideas that fit the project but are not on the path to 1.0. Value and effort are rough guesses.

| Idea | Value | Effort | Notes |
|---|---|---|---|
| Braille mode (2×4 dots per cell) | high | M | 8× the resolution; great for thin models |
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

## Open decisions

| Decision | Options | Recommendation | Needed by |
|---|---|---|---|
| When to publish to npm | at 0.2.0 (player ready) / at 1.0 | **0.2.0**: claims the name and lets people try it; 0.x signals that the API may change | 0.2.4 |
| When to make the repo public | with the first npm release / at 1.0 | **with the first npm release**: npm pages link to the repo | 0.2.4 |
| Browser tests | happy-dom in Node / Playwright headless | **happy-dom** for the elements, **Playwright** later for the playground | 0.2.4 |
| Default aspect for `textel render` | 2 (terminal) / 1.5 (common web fonts) | **2**, and document `--aspect` for web use; the viewer measures its own | 0.2.3 |
| Playground framework | plain TypeScript / a small framework | **plain TypeScript** with Vite; the site is small and uses the custom elements | 0.4 |
| Custom domain for the playground | GitHub Pages URL / own domain | decide at 0.4; GitHub Pages works first | 0.4 |

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
| Someone takes the `textel` name on npm first | publish 0.2.0 soon after the player works |
| Scope creep before a first release | the 1.0 list is the bar; everything else waits in "Could do" |

## Next session starts with

1. 0.2.4: esbuild, `<textel-player>`, size check, demo page
2. Then the decisions due at 0.2.4: npm publish, public repo, browser test tool
