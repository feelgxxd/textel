# Changelog

All notable changes to textel. Versions follow [semantic versioning](https://semver.org); before 1.0
the API may still change between minor versions. The frames file format has its own version
(see [docs/format.md](docs/format.md)).

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
