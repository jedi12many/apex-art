# apex-art

Editors for the [APEXSCII](https://github.com/jedi12many/apexscii) Commodore 64 character sets: build maps in five perspectives, draw characters and tiles, and export runnable programs. The character sets themselves live in the `apexscii` submodule.

```bash
git clone --recurse-submodules https://github.com/jedi12many/apex-art.git
cd apex-art
python -m http.server
```

Then open `http://localhost:8000/`. The pages have to be served; opening the files directly doesn't work. If you cloned without `--recurse-submodules`, run `git submodule update --init` first.

- `index.html` — map editor
- `art.html` — art tool for characters and tiles
- `apex-core.js` — maps, materials, objects, renderers, the compositor and tiles, on top of `apexscii/apexscii.js`; exposed together as `APEX`
- `build.js` — `node build.js` writes the runnable demo map for every perspective to `out/`
- `test/vice-check.js` — runs every demo in VICE and checks it pixel-for-pixel

## Map editor

Pick a perspective (isometric 2:1, military 45°, top-down 3/4, side oblique, first-person dungeon) and hi-res or multicolor. The screen is a live C64 render: what you see is exactly what the exported program shows.

- **Height-map views** (isometric, military, top-down, side) all show the same 8×8 world. Click a column on the screen or the top-down grid: Raise, Lower, Paint a material, place an Object (hero, tree, crystal), or Erase. Shift-click lowers; alt-click opens the cell's glyph.
- **Dungeon** has its own 16×16 maze. Click the grid to place walls, doors, floor or the player; walk with the arrow keys or WASD.
- **Compositor**: each 8×8 cell of the rendered map reuses an identical glyph or claims a blank slot, so objects and odd junctions get their own glyphs automatically. The editor shows how many free slots the map uses.
- **Status bar**: 1–3 lines at the bottom, shown in the C64's ROM font through a raster split (`{text}` for reverse video). For an exact preview, load the `chargen` file from your VICE install; it stays in your browser.
- **Glyph editor**: edit any character of the current set; the map updates live.
- **Export**: the map as a runnable `.prg` (`LOAD"*",8,1` then `RUN`) or `.asm`, and the character set as `.bin`, `.prg` or `.asm`.

## Art tool

- **Tiles**: draw blocks of characters (1×1 up to 8×8, or larger), such as floor diamonds, cubes and figures. You draw pixels across the whole tile, and each changed cell becomes characters again:
  - if an identical glyph exists, the cell reuses it
  - if the cell's glyph is used only by that cell, it's edited directly
  - otherwise the new glyph goes into a blank slot, so other tiles sharing the glyph don't change

  Turn off *protect shared glyphs* to edit a glyph everywhere it's used. *Stamp char*, *Pick* and *Cell colour* work on whole cells, like a PETSCII editor.
- **Characters**: edit any of the 256 glyphs in place.

Tools: pencil, line (with *angle snap* to horizontal, vertical or the view's slope: 2:1 in isometric, 45° in the others), rectangle, diamond (matching the built-in floor glyphs exactly), and flood fill. Also flip, shift, invert, copy/paste and undo/redo (Ctrl+Z / Ctrl+Y). Left button draws, right button erases. In multicolor you paint 4×8 fat pixels with four pens. The preview repeats the tile 3×3 in the view's own lattice so you can check seams. The *View* menu switches perspective; each one keeps its own characters and tiles, starting from a set of starter tiles.

Each perspective's character set is stored under one browser key shared by both editors, and each page picks up the other's changes live. Exports: charset `.bin`/`.prg`/`.asm`, tiles `.asm` (width, height, screen codes, colour RAM values), a `.png` tile sheet, and a project `.json` you can reopen.

## Updating the character sets

```bash
git submodule update --remote apexscii
git commit -am "Update apexscii"
```

## Testing

`test/vice-check.js` runs each demo `.prg` from `out/` in [VICE](https://vice-emu.sourceforge.io/), saves a screenshot, and compares all 64,000 display pixels with the editor's render of the same map, using VICE's ROM font for the status bar. Colours must map one-to-one onto VICE's palette, so a wrong character, colour or raster split shows up as differing pixels, reported by cell. It needs Node and a VICE install with `bin/x64sc` and `C64/chargen-901225-01.bin`.

```bash
node build.js
node test/vice-check.js "C:\path\to\GTK3VICE-3.10-win64"
```

`--ntsc` runs on an NTSC machine; `--cycles 12000000,15000017` screenshots each listed cycle count to check the split is stable across frames. It ends with PASS or FAIL and exits with 1 on any failure.
