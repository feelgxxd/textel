# Contributing to textel

Thanks for wanting to help. Bug reports, models that draw badly, ideas and pull requests are all welcome.

## Reporting

- **A bug**: open an issue with the bug template. A model file (or a link to one), the command or code
  you ran, and what you saw help the most. For the terminal, say which terminal and OS.
- **A model that looks wrong**: that counts as a bug. Attach the file if you can share it.
- **An idea**: open an issue with the idea template. Check [ROADMAP.md](ROADMAP.md) first; it may be
  there already, with notes.
- **A security problem**: do not open an issue. See [SECURITY.md](SECURITY.md).

## Setting up

You need Node 22 or newer. There is nothing else to install: the code is TypeScript that Node runs as is.

```sh
git clone https://github.com/feelgxxd/textel.git
cd textel
npm ci
npm test
```

| command | what it does |
|---|---|
| `npm run dev -- model.glb` | the CLI straight from the source |
| `npm test` | every test |
| `npm run typecheck` | TypeScript, without building |
| `npm run build` | `dist/`, and the browser bundles with their size check |
| `npm run size` | only the size check |
| `npm run site` | the playground and the docs at `localhost:5173/textel/` |
| `npm run snapshots` | rewrites the golden frames in `test/snapshots` (see below) |

## Where things are

| path | |
|---|---|
| `src/render.ts` | the rasterizer: a mesh and a style in, a grid of glyphs out |
| `src/style.ts` | every style option, its default and its range |
| `src/output.ts`, `src/ansi.ts` | text, ANSI and HTML output |
| `src/loaders/` | glTF (with meshopt and Draco), OBJ, STL |
| `src/mesh.ts`, `src/simplify.ts`, `src/sdf.ts` | meshes, smooth normals, simplifying, signed distance fields |
| `src/format.ts`, `src/frames.ts`, `src/svg.ts` | recordings, the frames format, animated SVG |
| `src/terminal.ts`, `src/cli/` | the terminal player and the `textel` command |
| `src/browser/` | `<textel-player>` and `<textel-viewer>` |
| `site/` | the playground, and `site/build/` makes the docs page |
| `test/` | one file per area; `snapshots/` holds the golden frames |

## What a change needs

- **Tests.** A fix comes with a test that fails without it; a feature with tests that show it working.
- **No runtime dependencies.** The package installs nothing else. Optional extras stay optional, as
  `draco3d` does.
- **Size.** The player and the viewer have size budgets, checked by `npm run build`. If a change needs
  more room, say why in the pull request.
- **Doc comments on everything exported.** The API reference on the docs page is made from them, and a
  test fails when an export has none. The README is the guide on that page too, so keep it current.
- **Golden frames.** `test/snapshots` holds frames of the examples. If your change is meant to change how
  things look, run `npm run snapshots`, look at the diff, and say in the pull request what changed and why.
- **The frames format** (`docs/format.md`) has its own version. A change that old players cannot read
  needs a new format version, not just a new package version.
- **CHANGELOG.md**: add a line under Unreleased.

## Style

- Plain TypeScript, ES modules, imports with their `.ts` extension.
- Comments say why, not what; a reader of the code should not need the pull request to understand it.
- Names spelled out over abbreviations, except in tight numeric loops.
- Commit messages in the imperative, one line that says what changes ("Keep glyphs steady while a model
  turns"), with more below if it needs it.

## Pull requests

Small and focused is easiest to review. For anything large, open an issue first so we can agree on the
shape before you spend time on it. CI runs the tests on Linux, macOS and Windows with Node 22 and 24.

By contributing you agree that your work is released under the [MIT License](LICENSE), and that you follow
the [code of conduct](CODE_OF_CONDUCT.md).
