# The textel frames format, version 1

A frames file holds a looped ASCII animation that is already rendered. A player only has to decode
it and print glyphs; it needs no 3D code. This page has everything needed to write a player in any
language.

## Container

A frames file is UTF-8 JSON, usually named `*.textel.json`:

```jsonc
{
  "textel": 1,                    // format version; a reader rejects versions it does not know
  "encoding": "rle-delta-1",      // how `data` is encoded (below)
  "width": 112,                   // grid size in cells
  "height": 56,
  "aspect": 2,                    // cell height / width the frames were rendered for
  "fps": 30,                      // playback rate
  "frameCount": 120,
  "glyphs": [" ", ".", ":", "#"], // glyph palette; index 0 is always " " (background)
  "styles": ["", "~", "#ffb000"], // optional style palette; index 0 is always ""
  "bg": "#1a1813",                // optional background color of the original look
  "data": "AAEC...",              // base64 of the encoded stream
  "meta": { "title": "..." }      // optional, free form
}
```

`glyphs` is an array so that every entry is exactly one glyph, whatever its UTF-16 length.

### Styles

Each cell has a style index into `styles`:

| value | meaning |
|---|---|
| `""` | the player's default color |
| `"~"` | the default color, dimmed (terminal faint, or reduced opacity on the web) |
| `"#rrggbb"` | that color |

When `styles` is missing, every cell uses the default color and the stream carries no style values.
Background cells (glyph 0) always use style 0.

The loop is seamless: after the last frame, playback continues with the first.

## Stream

`data` decodes to a byte stream. All integers in it are unsigned
[LEB128 varints](https://en.wikipedia.org/wiki/LEB128) (7 bits per byte, low bits first,
high bit set on every byte but the last).

Cells are numbered row by row: cell `i` is at column `i % width`, row `floor(i / width)`.
A cell's value is its glyph index, and its style index when the file has `styles`.

The stream is the frames one after another, `frameCount` of them, with nothing before, between
or after. Each frame starts with a type byte.

### A run

A run covers consecutive cells that share one value:

```
run     varint   number of cells, at least 1
glyph   varint   index into glyphs
style   varint   index into styles (only when the file has styles)
```

### Key frame (type `0`)

Runs that cover all `width * height` cells exactly.

### Delta frame (type `1`)

Starts from a copy of the previous frame and replaces some spans of cells.

```
spans   varint   number of spans that follow
then for each span:
  skip  varint   cells to leave unchanged, counted from the end of the previous span (or cell 0)
  count varint   cells in this span, at least 1
  runs           runs covering exactly `count` cells
```

A frame identical to the previous one is a type byte `1` and a span count `0`.
The first frame of a file is always a key frame.

An encoder may choose either type for any frame after the first; the reference encoder picks
whichever is smaller.

## Validation

A reader should reject a file when:

- `textel` is not a version it supports, or `encoding` is unknown
- a run or span would pass the end of the grid, or a run or span length is 0
- the stream ends before `frameCount` frames, or has bytes left after them
- a glyph or style index is outside its palette

## Sizes

Measured with the built-in examples, 120 frames at 112×56 (`node bench/frames-size.ts`),
average over the examples:

| look | plain text | file | gzip | brotli |
|---|---|---|---|---|
| no color | 742 KB | 155 KB | 47 KB | 36 KB |
| gradient | 742 KB | 327 KB | 93 KB | 69 KB |

Static hosting (GitHub Pages, most CDNs) compresses JSON on the fly, so the gzip column is what
visitors download.

## Reference implementation

`src/frames.ts`: `recordLoop` renders a loop, `stringifyFrames` / `parseFrames` write and read the
container, `encodeStream` / `decodeStream` handle the stream alone.
