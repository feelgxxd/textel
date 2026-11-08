# Changelog

All notable changes to textel. Versions follow [semantic versioning](https://semver.org); before 1.0
the API may still change between minor versions. The frames file format has its own version
(see [docs/format.md](docs/format.md)).

## Unreleased

### Added
- Animated SVG: `textel render <model> -o out.svg`, `recordingSVG()` in the library, and an **Image** tab in
  the playground. Plays without scripts, so it works in GitHub READMEs; follows the reader's light or dark
  theme when it has no colors of its own; still for readers who prefer reduced motion

## 0.4.0 (2026-11-09)

### Added
- The playground at [feelgxxd.github.io/textel](https://feelgxxd.github.io/textel/): load a model or an
  example, tune the look live, share it as a link, and export embeds, recorded loops, CLI commands and presets

### Changed
- `<textel-viewer zoomable>` also zooms with a two-finger pinch on touch screens, and keeps vertical drags
  for tilting instead of scrolling the page
- The `dice` example builds about five times faster (from 0.8 s to under 0.2 s), with the same mesh

## 0.3.0 (2026-11-09)

### Added
- `<textel-viewer>` (`@feelgxxd/textel/viewer`, about 11 KB gzipped): renders a model live in the page.
  Measures the page font so nothing is squashed; drag in any direction with a flick that eases back;
  arrow keys and space when focused; optional wheel zoom; loads `.glb`, `.gltf` with external buffers,
  `.obj` and `.stl`; style from a preset, attributes and `.look`
- `parseModelAsync` and `parseModelSteps`: parse large text models in slices so a page keeps responding
  (a 7 MB `.obj` froze a page for 120 ms; now for at most about 20 ms at a time)
- `fitPitch` style option: the model stays inside the grid for any tilt up to that angle
- `colorSteps` style option: how many colors a gradient uses
- `npm run demo` also serves a viewer page and a benchmark of ways to update the page

### Changed
- Gradients now use one color per glyph of the ramp by default instead of a different color for
  almost every cell. They look the same at a glance, and draw far cheaper: a 160×80 frame went from
  ~5000 color spans to ~900 (13 ms → 3.6 ms per frame in Chrome), ANSI output shrank to a quarter,
  and gradient frames files to about half. `colorSteps: 0` restores smooth gradients.

### Fixed
- `<textel-player>` and `<textel-viewer>` use their own document for lifecycle and timing, so they
  no longer fail while a page is being torn down, and work inside iframes
- The player's first animation step no longer mixes two clocks, which could make it start late

## 0.2.0 (2026-11-08)

First release, published as `@feelgxxd/textel` (npm did not accept the unscoped name). The command is `textel`.

### Rendering
- Software rasterizer that draws triangle meshes into a character grid, with supersampling,
  correction for tall character cells, and automatic fit for a turntable spin
- Loaders for glTF / GLB (node transforms, material names), OBJ and STL
- Materials by name: `solid`, `carved` (blank but still hides what is behind it), `dim`,
  or their own ramp, color and opacity
- Outline and depth edges drawn with `- / | \` at the angles those glyphs have in a cell
- Color: none, one color, or a gradient by brightness; truecolor and 256-color terminal output, and HTML
- `@feelgxxd/textel/sdf`: signed distance field primitives and surface-nets meshing, so shapes can be written in code
- Built-in examples: donut, dice, rocket, planet, mug, gem

### Terminal
- `textel <model>`: spins a model live, with keys for rotation, zoom, charset, edges and light
- `textel render`: records a seamless loop into a `.textel.json` file
- `textel play`: plays a recorded file (pause, step, speed)
- `textel list`, `textel help <command>`; `--once` prints a single frame for scripts
- `@feelgxxd/textel/terminal`: `play()` and `playSplash()` for other command line tools

### Web
- `<textel-player>` custom element (`@feelgxxd/textel/player`, about 3 KB gzipped): plays a frames file, fits its box,
  keeps the rendered proportions in any font, scrubs on drag, pauses off screen, honors reduced motion

### Frames format
- Version 1: JSON with a glyph palette, an optional style palette and a varint stream of run-length
  key frames and delta frames; documented for other players
