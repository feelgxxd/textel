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

## 0.1: core and terminal ✅

- [x] Software rasterizer into a character grid: supersampling, aspect correction, auto fit for a turntable spin
- [x] Loaders: glTF / GLB (node transforms, material names), OBJ, STL
- [x] Materials by name: `solid`, `carved`, `dim`, or own ramp / color / opacity
- [x] Outline and depth edges with directional glyphs
- [x] SDF primitives and surface-nets meshing (`textel/sdf`), with a generator variant for idle-time builds
- [x] Built-in examples: donut, dice, rocket, planet, mug, gem
- [x] CLI: live animation with keyboard controls, single frame output, presets, color depth detection
- [x] Text, ANSI (truecolor / 256) and HTML output
- [x] Tests for loaders, meshing and rendering

**Known gaps** (picked up in later milestones):
- Live mode is only verified by hand in a real terminal; there is no automated check for it.
- Draco / meshopt compressed glTF is rejected with a message.
- Models without normals are flat shaded; there is no crease-angle smoothing.
- glTF without a scene uses all root nodes; multiple scenes are not selectable.
- Fit is computed for the resting pitch; dragging far up or down can clip the model.

---

## 0.2: frames file and player

Render once, play anywhere, without shipping the renderer.

### 0.2.1 Housekeeping first ✅
- [x] `.gitattributes` (`* text=auto eol=lf`) so the repo keeps LF line endings
- [x] GitHub Actions: `npm ci`, `tsc`, `npm test`, build and a CLI smoke test on Windows, macOS, Linux (Node 22, 24;
  Node 20 reached end of life in April 2026 and cannot run the `.ts` tests directly)
- [x] CLI restructured into subcommands, keeping `textel <model>` as the live preview:
  `textel [preview] <model>`, `textel list`, `textel help <command>`; `render` and `play` slot in with 0.2.3
- [x] Golden-frame tests: every example (and a few style variants) rendered at a fixed size and yaw, compared
  to a stored text snapshot (catches unintended visual changes; `npm run snapshots` to update)

### 0.2.2 The `.textel.json` format
A frames file is a looped animation, already rendered. The full spec is in [docs/format.md](docs/format.md):
a JSON header with a glyph palette and an optional style palette (color / dim per cell), and a base64
varint stream where the first frame is run-length encoded and every later frame is either a key frame
or only the spans that changed, whichever is smaller.

- [x] Encoder and decoder in the core (`recordLoop`, `encodeStream` / `decodeStream`, `stringifyFrames` / `parseFrames`)
- [x] Round-trip tests: every example with and without color, plus random recordings with large palettes
- [x] Measure (`bench/frames-size.ts`), 120 frames at 112×56, gzipped JSON: 47 KB average / 89 KB worst without color,
  93 KB average / 188 KB worst with a gradient; both under target (100 / 250 KB)
- [x] Decide on JSON + base64 vs. a binary `.textel` file: **JSON** for version 1. Sizes are well under target;
  JSON is one `fetch().json()` away, readable, embeddable in a single HTML file, and compressed by static hosts.
  Binary is ~25% smaller after gzip and can be added later as a second container for the same stream.
- [x] Write the format down in `docs/format.md` so others can write players

### 0.2.3 `textel render` and `textel play`
- [ ] `textel render <model> -o out.textel.json [--frames 120] [--fps 30] [--size 112x56] [style flags]`
  - yaw goes from 0 to 2π over the frames, so the loop is seamless
  - progress bar, total size printed at the end
- [ ] `textel play <file>`: plays a frames file in the terminal, same keys as preview (pause, quit; drag scrub via ←→)
- [ ] `textel/terminal`: `playSplash(file, { seconds, once })` for other CLIs to show a spinning logo, then return

### 0.2.4 `textel/player` for the web
- [ ] `<textel-player src="logo.textel.json">` custom element, no dependencies, **< 5 KB min+gzip**
- [ ] Attributes: `src`, `fps`, `autoplay`, `drag` (scrub on horizontal drag), `color` (override for colorless files)
- [ ] Styling through CSS: font, size, color, `--textel-glow`; the element scales its `<pre>` to fit its box
- [ ] Pauses off screen (IntersectionObserver) and in hidden tabs; shows a still frame under `prefers-reduced-motion`
- [ ] Frame-rate independent timing; no catch-up jumps after a tab switch
- [ ] `role="img"` with an `aria-label` from `meta.title`
- [ ] A browser bundle (esbuild) published as `textel/player` plus a CDN-friendly single file

**Done when** a file made with `textel render` plays the same in `textel play` and in `<textel-player>`,
and a test page with the player loads under the size budget.

---

## 0.3: live viewer

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
- [ ] Size budget: viewer + core + loaders < 25 KB min+gzip
- [ ] Fit while dragging: refit or clamp pitch so the model never clips

**Done when** the viewer can be dropped into a plain HTML page with one script tag and
feels smooth at 60 fps on a mid-range phone with a 50k-triangle model.

---

## 0.4: playground (GitHub Pages)

Built with Vite and plain TypeScript, using the viewer itself, so the site is also the viewer's test bench.

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

- [ ] **Animated SVG**: one `<text>` per row per frame, stepped with CSS animation; works inside GitHub
  READMEs where scripts do not run. Size budget to be measured; offer fewer frames / smaller grids
- [ ] **GIF and MP4**: done in the playground with canvas (and WebCodecs for MP4 where available);
  from the CLI as an optional add-on so the main package stays dependency-free
- [ ] **Single frame**: PNG (playground), plain text and ANSI (CLI, already possible with `--once`)
- [ ] **Single-file HTML**: player and frames inlined, works offline

---

## 1.0: release

### Quality
- [ ] Crease edges from normal discontinuities, not only silhouettes and depth steps
- [ ] Steadier glyphs while spinning: hysteresis on edge glyphs and ramp steps
- [ ] Model colors: vertex colors and material base color as a color mode
- [ ] Smooth shading for models without normals, with a crease angle so hard edges stay hard
- [ ] Large models: automatic decimation above a triangle budget
- [ ] Draco and meshopt compressed glTF

### Project
- [ ] Docs on the playground site: getting started, CLI reference, preset reference, API reference, format spec
- [ ] Terminal compatibility notes: Windows Terminal, conhost, macOS Terminal, iTerm2, GNOME Terminal, kitty, Alacritty
- [ ] CONTRIBUTING, code of conduct, issue and PR templates, CHANGELOG
- [ ] Semantic versioning from here on; the frames format keeps its own version
- [ ] Repo goes public; first npm release (`textel` was free when the project started)

---

## After 1.0

- **Glyph modes**: shape-matched glyphs (pick the glyph whose shape matches the cell's coverage),
  braille (2×4 dots per cell), half blocks (two "pixels" per cell, with color)
- **Lighting**: several lights, specular, toon steps, rim light
- **Animation**: play the model's own glTF animations, not only the turntable spin
- **Web effects**: scanlines, CRT curvature, glow, phosphor trails
- **Wrappers**: React, Vue, Svelte, Astro components
- **Community**: a preset gallery people can submit to

---

## Cross-cutting

| Area | Plan |
|---|---|
| Testing | unit tests for loaders, format and math; golden-frame snapshots for visuals; size budget checks in CI |
| Performance | track ms per frame for each example at 112×56 and 160×50 in a bench script; flag regressions |
| Compatibility | Node 22+; evergreen browsers; terminals listed above |
| Bundle sizes | player < 5 KB, viewer < 25 KB (min+gzip), checked in CI |

## Risks

| Risk | Mitigation |
|---|---|
| Frames files too big for casual embeds | measure early in 0.2.2; deltas + RLE; fewer frames or smaller grids as presets |
| Glyph aspect differs per font and platform | measure in the browser; `--aspect` in the terminal; document common values |
| Huge or odd models (millions of triangles, broken normals) | triangle budget with decimation; two-sided lighting is already in place |
| Terminals handle fast redraws differently | redraw only changed rows; cap fps; compatibility notes |
| Scope creep before a first release | the 1.0 list is the bar; everything else waits in "After 1.0" |

## Next session starts with

1. 0.2.2 format: encoder / decoder, round-trip tests, size measurements, then decide JSON vs binary
2. 0.2.3 `textel render` and `textel play` on top of it
