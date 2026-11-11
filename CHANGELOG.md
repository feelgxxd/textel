# Changelog

All notable changes to textel. Versions follow [semantic versioning](https://semver.org): from 1.0, a
change that breaks code using textel needs a new major version. The frames file format has its own
version (see [docs/format.md](docs/format.md)), so a new package version never stops old files playing.

## 1.1.0 (2026-11-11)

### Added
- "What you can make" in the README and the docs, and a "Use it as" row in the playground: the six
  things people make with textel, each with its snippet or the export that makes it
- `Renderer.replaceStyle(input)`: the whole style at once, in place of everything given before. `setStyle`
  merges, so a field it leaves out or sets to undefined keeps its old value

### Fixed
- A custom ramp stuck in `<textel-viewer>` and the playground: after one, picking a named charset changed
  nothing until the page was reloaded. The same went for color set back to none, a material style taken
  away, and a preset with fewer fields; the viewer now hands its whole style over each time
- In the terminal preview, `c` did nothing after `--chars`, and `r` did not undo every key
- The CLI no longer prints a crash when the reader of its output stops early (`textel ... | head`)
- The playground makes every file at the preview's Width: recordings, the HTML page, SVG, GIF, MP4
  and PNG were made at a fixed size (112 or 80 characters wide) whatever the Width, so a file could have
  less detail than the preview. The render command it shows now carries the same `--size`

### Changed
- The package's homepage is the playground site

## 1.0.0 (2026-11-09)

The first stable release. The names, options and file format are frozen; from here on they change only
in a new major version. Since 0.5: crease edges, steady glyphs, the model's own colors, smooth shading
for models without normals, simplified drawing of very dense models, meshopt and Draco compressed glTF,
an API review, and docs on the playground site.

### Added
- `edges: 'crease'` (`--edges crease`, `edges="crease"`, the playground's Outline list, and `e` in the
  terminal preview): lines along folds of the surface as well, such as the edges of a cube or a gem's
  facets, one cell wide. `creaseAngle` sets how sharp a fold must be (40° by default)
- The model's own colors: `color: 'model'` (`--color model`, `color="model"`, "the model's own" in the
  playground). Reads glTF base colors and vertex colors (`COLOR_0`), OBJ vertex colors and `.mtl` diffuse
  colors; the viewer fetches an `.obj`'s `.mtl` next to it, and the CLI reads it from the same folder.
  Textures are not read yet: when a model keeps its colors in one, the CLI and the playground say so
  (`Mesh.textured`). The examples have colors of their own, and `sdfToMesh` takes a `color`
  function
- Compressed glTF. meshopt (`EXT_meshopt_compression` and `KHR_meshopt_compression`, as gltfpack and
  gltf-transform write it) is decoded by textel itself, in the CLI, the library, the viewer and the
  playground. Draco (`KHR_draco_mesh_compression`) goes through Google's `draco3d` package, an optional
  peer that textel does not ship: the CLI loads it when a file needs it and says how to install it
  otherwise; in the library, `createDracoDecoder()` from `@feelgxxd/textel/draco` makes the `draco`
  option of `parseModel` and `parseGLTF`
- `Mesh.colors` and `Mesh.materialColors`, `MeshBuilder.vertexColor()` and `materialColor()`, and
  `Frame.rgb`; `parseOBJ` takes `{ resolve }` for the material library
- Models without normals (STL, many OBJ files) shade smooth except across folds sharper than
  `creaseAngle`, instead of showing every face: a low-poly ball looks round, a box keeps its corners.
  `shading: 'flat'` brings the facets back. `creaseNormals()` in the library
- Steadier glyphs while a model turns (`steady`, on by default): a cell keeps its glyph until its
  brightness is clearly past the next step, and lines keep their direction. Glyphs that blink for one
  frame and back are 75 to 90% fewer, and a recorded gem is about a quarter smaller. Recorded loops stay
  seamless. `"steady": 0` makes every frame independent of the one before, as it was
- Models with more than 300 000 triangles are drawn from a simplified copy (`maxTriangles`, 0 turns it
  off), which looks the same at grid size: two million triangles draw in 8 ms a frame instead of 35, and
  simplifying them takes about 160 ms once. `simplifyMesh()` in the library
- Docs on the playground site at [feelgxxd.github.io/textel/docs](https://feelgxxd.github.io/textel/docs/):
  the guide, the CLI reference, the API and style reference (with defaults) and the frames format. It is
  made at build time from the README, the CLI's own help and the doc comments, so it follows the code;
  every export now has a doc comment
- CONTRIBUTING, a code of conduct, SECURITY (report privately through GitHub), issue and pull request
  templates, and notes on terminals in the README

### Changed
- API review before 1.0. Removed: `computeSmoothNormals()` (use `creaseNormals(mesh, 180)`), the
  `--list` flag (use `textel list`), and `toBase64` / `fromBase64`, which `@feelgxxd/textel/frames`
  exported by accident. Renamed: `RecordOptions.colorStep` is `colorRound`, so it is not mistaken for the
  style's `colorSteps`. Now exported: `ModelOptions` (the options of `parseModel`; `GltfOptions` and
  `ObjOptions` are still there), `DracoDecode`, `ResolvedMaterial`, `ResolvedColor` and `parseOBJSteps`
- The viewer is about 16 KB gzipped (was 11 KB), with steady glyphs, model colors, simplifying and meshopt; its size budget is now 17 KB

### Fixed
- The playground keeps a plain address until the look changes, and again when it is back to how it
  started; before, the look was always written into the URL hash
- `setStyle({ shading: 'flat' })` on a renderer that had drawn smooth kept drawing smooth
- `shading: 'smooth'` welds vertices about four times faster (89k triangles: 100 ms to 20 ms)
- `depth` edges no longer fill a face seen at a slant with lines: a step is now told from a face whose
  depth only changes fast but evenly. The gem example and some looks change a little because of it
- The gem example has a little ambient light, so its unlit facets show instead of leaving gaps

## 0.5.0 (2026-11-09)

### Added
- Animated SVG: `textel render <model> -o out.svg`, `recordingSVG()` in the library, and an **Image** tab in
  the playground. Plays without scripts, so it works in GitHub READMEs; follows the reader's light or dark
  theme when it has no colors of its own; still for readers who prefer reduced motion
- GIF and MP4 from the playground's **Image** tab, made in the browser with no extra packages: a small
  GIF encoder that stores only what changes between frames, and an MP4 writer around the browser's own
  H.264 encoder
- A PNG of the preview at the angle it shows, from the **Image** tab
- A single HTML file with the player and the frames inside, from the **Recorded loop** tab; opens offline
- `viewer.view`: the viewer's camera as drawn (yaw, pitch, zoom, fitPitch), to render the same picture again

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
