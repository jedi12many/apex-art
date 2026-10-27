/*
 * apex-art core — maps, materials, objects and renderers for every APEXSCII perspective, the
 * compositor that turns a rendered map into screen codes, and tiles.
 *
 * The character sets come from APEXSCII (the apexscii submodule). Everything is exposed as one APEX
 * object — APEXSCII's API plus the map and tile code — so the editors see a single library.
 * Works in the browser (load apexscii/apexscii.js first) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./apexscii/apexscii.js'));
  else root.APEX = factory(root.APEXSCII);
})(typeof self !== 'undefined' ? self : this, function (APEXSCII) {
  'use strict';
  const { SETS, MC_SETS, PERSPECTIVES, asciiToScreen, hex } = APEXSCII;

  // Browser storage key for a perspective's charset; the isometric keys predate perspectives.
  const charsetKey = (persp, mode) => (persp === 'iso' ? 'apexscii.charset' : `apexscii.${persp}.charset`) + (mode === 'mc' ? '.mc' : '');

  // colors: hi-res colour per face. mcColor: the multicolor cell colour (0-7) for the "11" pixels.
  const MATERIALS = [
    { name: 'Grass', set: 'smooth', colors: { T: 13, L: 8, R: 9 }, mcColor: 5 },
    { name: 'Stone', set: 'smooth', colors: { T: 15, L: 12, R: 11 }, mcColor: 1 },
    { name: 'Brick', set: 'brick', colors: { T: 8, L: 10, R: 2 }, mcColor: 2 },
    { name: 'Water', set: 'smooth', colors: { T: 14, L: 6, R: 6 }, mcColor: 6 },
    { name: 'Sand', set: 'smooth', colors: { T: 7, L: 8, R: 9 }, mcColor: 7 },
    { name: 'Paving', set: 'brick', colors: { T: 15, L: 12, R: 11 }, mcColor: 4 },
  ];

  // Objects: 16x24, '.' transparent, 'o' opaque gap (ink off), other letters = ink in palette color.
  // mc maps each ink letter to [2-bit value, cell colour]; in multicolor a pixel pair becomes one fat pixel.
  const OBJECTS = [
    { name: 'Hero', palette: { '#': 1 }, mc: { '#': [1] }, rows: [
      '................', '................', '......oooo......', '.....o####o.....',
      '....o######o....', '....o#o##o#o....', '....o######o....', '.....o####o.....',
      '....oo#oo#oo....', '...o########o...', '..o#o######o#o..', '..o#o######o#o..',
      '..o#o######o#o..', '...oo######oo...', '....o##oo##o....', '....o##oo##o....',
      '....o##oo##o....', '....o##oo##o....', '...o###oo###o...', '...oooo..oooo...',
      '................', '................', '................', '................'] },
    { name: 'Tree', palette: { '#': 5, 't': 9 }, mc: { '#': [3, 5], 't': [2] }, rows: [
      '......oooo......', '....oo####oo....', '...o########o...', '..o##########o..',
      '..o###o##o###o..', '.o############o.', '.o##o######o##o.', '.o############o.',
      '.o###o####o###o.', '..o##########o..', '..o####oo####o..', '...oo##tt##oo...',
      '.....oottoo.....', '......otto......', '......otto......', '......otto......',
      '......otto......', '.....otttto.....', '....oooooooo....', '................',
      '................', '................', '................', '................'] },
    { name: 'Crystal', palette: { '#': 3 }, mc: { '#': [3, 3] }, rows: [
      '................', '................', '................', '................',
      '................', '................', '.......oo.......', '......o##o......',
      '.....o####o.....', '....o##o###o....', '....o##o###o....', '...o###o####o...',
      '...o###o####o...', '....o##o###o....', '.....o#o##o.....', '......o##o......',
      '.......oo.......', '................', '................', '................',
      '................', '................', '................', '................'] },
  ];

  // --------------------------------------------------------------- the map
  const W = 320, H = 200, N = 8, MAX_H = 6;
  const ORIGIN_X = 144, BASE_Y = 48; // multiples of 8 keep every edge char-aligned

  // Map cells: m = material index (-1 for nothing), h = height, o = object index (-1 for none).
  // Optional ox/oy shift a cell's object by pixels, for moving it smoothly between cells.
  function defaultMap() {
    const rows = [
      'b4 b3 b2 s1 g1 g1 g1T g1',
      'b3 b2 s1 g1 g1 g1 g1 g1',
      'b2 s1 g1 g1 g1 w1 w1 g1T',
      's1 g1 g1 g1 w1 w1 w1 g1',
      'g1T g1 g1H g1 a1 w1 a1 g1',
      'g1 g1 g1 g1 g1 a1 g1 g1',
      'g1 s2 g1 g1 g1 g1 g1 g1T',
      'g1 s2C g1T g1 p1 p1 g1 g1',
    ];
    const M = { g: 0, s: 1, b: 2, w: 3, a: 4, p: 5 }, O = { H: 0, T: 1, C: 2 };
    const cells = [];
    for (const r of rows) for (const t of r.split(' ')) {
      cells.push({ m: M[t[0]], h: +t[1], o: t[2] ? O[t[2]] : -1 });
    }
    return { size: N, cells, caption: '{ APEXSCII } ISOMETRIC PETSCII', bg: 0, border: 0, textColor: 7, split: true,
             mode: 'hires', mc1: 12, mc2: 11, persp: 'iso', dungeon: defaultDungeon() };
  }

  // Draw one iso block with its 32x32 box at (sx, sy) through plot(x, y, value, colour, isObj).
  // Multicolor values are computed per pixel pair, so they come out duplicated across each pair.
  function drawBlock(plot, sx, sy, mat, mc, withSides) {
    const set = SETS[mat.set], mset = MC_SETS[mat.set];
    for (let px = 0; px < 32; px++) {
      const left = px < 16;
      const top = left ? 7 - (px >> 1) : (px - 16) >> 1;
      const bot = left ? 8 + (px >> 1) : 15 - ((px - 16) >> 1);
      const end = withSides ? bot + 16 : bot;
      for (let py = top; py < end; py++) {
        const f = py < bot ? 'T' : (left ? 'L' : 'R');
        const x = sx + px, y = sy + py;
        if (mc) plot(x, y, mset[f](x >> 1, y), mat.mcColor, false);
        else plot(x, y, set[f](x, y), mat.colors[f], false);
      }
    }
  }

  // Draw a 16x24 object with its top-left at (ox, oy); 'o' pixels clear ink, '.' is transparent.
  function drawObject(plot, ob, ox, oy, mc) {
    if (mc) ob.rows.forEach((r, y) => {
      for (let x = 0; x < 16; x += 2) {
        const a = r[x], b = r[x + 1];
        const ch = /[^.o]/.test(a) ? a : /[^.o]/.test(b) ? b : (a === 'o' || b === 'o') ? 'o' : '.';
        if (ch === '.') continue;
        const [v, c] = ch === 'o' ? [0, -1] : ob.mc[ch];
        for (const dx of [0, 1]) plot(ox + x + dx, oy + y, v, c === undefined ? -1 : c, ch !== 'o');
      }
    });
    else ob.rows.forEach((r, y) => {
      for (let x = 0; x < 16; x++) {
        const ch = r[x];
        if (ch === '.') continue;
        if (ch === 'o') plot(ox + x, oy + y, 0, -1, false);
        else plot(ox + x, oy + y, 1, ob.palette[ch], true);
      }
    });
  }

  // ------------------------------------------------- the other perspectives
  // Plot one pixel of a face, using the perspective's pattern for it and the material's colour.
  const FACE_COLOR = { T: 'T', L: 'L', F: 'L', R: 'R', W: 'T', S: 'L', G: 'R' };
  function facePixel(plot, x, y, mat, persp, face, mc) {
    const key = PERSPECTIVES[persp].key[face];
    if (mc) plot(x, y, MC_SETS[mat.set][key](x >> 1, y), mat.mcColor, false);
    else plot(x, y, SETS[mat.set][key](x, y), face === 'D' ? 8 : face === 'C' ? 0 : mat.colors[FACE_COLOR[face]], false);
  }

  // Military: a 16x16 diamond (2x2 chars) with 45° edges, and `side` pixels of wall below it.
  function drawMilitaryBlock(plot, sx, sy, mat, mc, side) {
    for (let px = 0; px < 16; px++) {
      const l = px < 8 ? px : 15 - px, top = 7 - l, bot = 8 + l;
      for (let py = top; py < bot + side; py++)
        facePixel(plot, sx + px, sy + py, mat, 'military', py < bot ? 'T' : px < 8 ? 'L' : 'R', mc);
    }
  }

  // Top-down 3/4: a 16x16 top with outlines where a neighbour is lower, then 8px of front face
  // per height unit. `nb` holds the N/E/S/W neighbour heights (-1 for nothing there).
  function drawObliqueBlock(plot, sx, top, mat, mc, h, nb) {
    const atW = px => mc ? px <= 1 : px === 0, atE = px => mc ? px >= 14 : px === 15; // whole fat pixels in MC
    for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
      const edge = (py === 0 && nb.N < h) || (py === 15 && nb.S < h) || (atW(px) && nb.W < h) || (atE(px) && nb.E < h);
      if (edge) plot(sx + px, top + py, 0, -1, false);
      else facePixel(plot, sx + px, top + py, mat, 'oblique', 'T', mc);
    }
    for (let z = 0; z < h; z++) {
      const y0 = top + 16 + (h - 1 - z) * 8;
      for (let py = 0; py < 8; py++) for (let px = 0; px < 16; px++) {
        if ((atW(px) && nb.W <= z) || (atE(px) && nb.E <= z)) plot(sx + px, y0 + py, 0, -1, false);
        else facePixel(plot, sx + px, y0 + py, mat, 'oblique', 'F', mc);
      }
    }
  }

  // Side oblique (cabinet): 16x16 front face, top face receding up-right by 8px at 45°,
  // and an 8px side face on the right. `full` false draws only the top (a block at ground level).
  function drawSideBlock(plot, sx, sy, mat, mc, full) {
    for (let r = 0; r < 8; r++) for (let x = 7 - r; x < 23 - r; x++) facePixel(plot, sx + x, sy - 8 + r, mat, 'side', 'T', mc);
    if (!full) return;
    for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) facePixel(plot, sx + px, sy + py, mat, 'side', 'F', mc);
    for (let c = 0; c < 8; c++) for (let y = sy - 1 - c; y <= sy + 14 - c; y++) facePixel(plot, sx + 16 + c, y, mat, 'side', 'R', mc);
  }

  // The height-map views all read the same map, so one world can be seen from any of them.
  const VIEW_RENDERERS = {
    military(map, plot, mc, setIdx) {
      const n = map.size;
      for (let s = 0; s <= 2 * n - 2; s++) for (let gx = Math.max(0, s - n + 1); gx <= Math.min(s, n - 1); gx++) {
        const gy = s - gx, c = map.cells[gy * n + gx];
        if (c.m < 0) continue;
        setIdx(gy * n + gx);
        const sx = 152 + (gx - gy) * 8, top = 48 + (gx + gy) * 8 - c.h * 8;
        drawMilitaryBlock(plot, sx, top, MATERIALS[c.m], mc, c.h * 8);
        if (c.o >= 0) drawObject(plot, OBJECTS[c.o], sx + (c.ox || 0), top - 14 + (c.oy || 0), mc);
      }
    },
    oblique(map, plot, mc, setIdx) {
      const n = map.size, hAt = (x, y) => {
        const c = x >= 0 && y >= 0 && x < n && y < n ? map.cells[y * n + x] : null;
        return c && c.m >= 0 ? c.h : -1;
      };
      for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
        const c = map.cells[gy * n + gx];
        if (c.m < 0) continue;
        setIdx(gy * n + gx);
        const sx = 96 + gx * 16, top = 48 + gy * 16 - c.h * 8;
        drawObliqueBlock(plot, sx, top, MATERIALS[c.m], mc, c.h,
          { N: hAt(gx, gy - 1), E: hAt(gx + 1, gy), S: hAt(gx, gy + 1), W: hAt(gx - 1, gy) });
        if (c.o >= 0) drawObject(plot, OBJECTS[c.o], sx + (c.ox || 0), top - 10 + (c.oy || 0), mc);
      }
    },
    side(map, plot, mc, setIdx) {
      const n = map.size;
      for (let gz = n - 1; gz >= 0; gz--) for (let gx = 0; gx < n; gx++) {
        const gy = n - 1 - gz, c = map.cells[gy * n + gx]; // map row 0 is the far side
        if (c.m < 0) continue;
        setIdx(gy * n + gx);
        const mat = MATERIALS[c.m], sx = 64 + gx * 16 + gz * 8, ground = 176 - gz * 8;
        if (c.h === 0) drawSideBlock(plot, sx, ground, mat, mc, false);
        else for (let z = 0; z < c.h; z++) drawSideBlock(plot, sx, ground - 16 - z * 16, mat, mc, true);
        if (c.o >= 0) drawObject(plot, OBJECTS[c.o], sx + 4 + (c.ox || 0), ground - 16 * c.h - 24 + (c.oy || 0), mc);
      }
    },
  };

  // ------------------------------------------------------------------ dungeon
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W
  const DIR_NAMES = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
  // Wall boxes (half width, half height) at each distance; equal steps on both axes keep every
  // perspective edge at exactly 45°, and every corner on a char boundary.
  const DUNGEON_BOXES = [[80, 64], [56, 40], [40, 24], [32, 16]];
  const ARROW = ['...##...', '..####..', '.######.', '########', '...##...', '...##...', '...##...', '........'];

  function defaultDungeon() {
    return {
      size: 16, mat: 1, x: 8, y: 8, dir: 0,
      rows: [
        '################', '#..............#', '#.####.#####.#.#', '#.#....#...#.#.#',
        '#.#.####.#.#.#.#', '#.#......#...#.#', '#.######D#####.#', '#......#.......#',
        '######.#.#####.#', '#......#.#...#.#', '#.######.#.#.#.#', '#.#......#.#...#',
        '#.#.######.###.#', '#.#........#...#', '#...######...#.#', '################',
      ],
    };
  }
  const dungeonAt = (d, x, y) => x < 0 || y < 0 || x >= d.size || y >= d.size ? '#' : d.rows[y][x];

  // First-person view (160x128 at vx,vy), drawn far to near, plus an optional minimap to the right.
  function renderDungeon(d, plot, mc, vx, vy, withMap) {
    const mat = MATERIALS[d.mat], cx = vx + 80, cy = vy + 64;
    const f = DIRS[d.dir], l = DIRS[(d.dir + 3) % 4], r = DIRS[(d.dir + 1) % 4];
    const px = (x, y, face) => facePixel(plot, x, y, mat, 'dungeon', face, mc);
    const rect = (x0, y0, x1, y1, face) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px(x, y, face); };
    for (let y = vy; y < vy + 128; y++) for (let x = vx; x < vx + 160; x++) px(x, y, y < cy ? 'C' : 'G');
    const cell = (dist, side) => dungeonAt(d, d.x + f[0] * dist + side[0], d.y + f[1] * dist + side[1]);
    const solid = c => c !== '.';
    for (let dist = 2; dist >= 0; dist--) {
      const [hw0, hh0] = DUNGEON_BOXES[dist], [hw1, hh1] = DUNGEON_BOXES[dist + 1], span = hw0 - hw1;
      for (const [side, sign] of [[l, -1], [r, 1]]) {
        if (solid(cell(dist, side))) {
          for (let k = 0; k < span; k++) { // wall slice k pixels in from the outer edge
            const x = sign < 0 ? cx - hw0 + k : cx + hw0 - 1 - k;
            for (let y = cy - hh0 + k; y <= cy + hh0 - 2 - k; y++) px(x, y, 'S');
          }
        } else if (solid(cell(dist + 1, side))) { // an opening shows the far corridor's wall face-on
          const x0 = sign < 0 ? cx - hw0 : cx + hw1;
          rect(x0, cy - hh1, x0 + span, cy + hh1, 'W');
        }
      }
      const ahead = cell(dist + 1, [0, 0]);
      if (solid(ahead)) {
        rect(cx - hw1, cy - hh1, cx + hw1, cy + hh1, 'W');
        if (ahead === 'D') {
          const dw = Math.round(hw1 / 2 / 8) * 8, dh = Math.round(hh1 * 1.5 / 8) * 8;
          rect(cx - dw, cy + hh1 - dh, cx + dw, cy + hh1, 'D');
        }
      }
    }
    if (!withMap) return;
    const mx = vx + 176, my = vy;
    for (let y = 0; y < d.size; y++) for (let x = 0; x < d.size; x++) {
      const c = dungeonAt(d, x, y);
      if (c === '.') continue;
      for (let py = 0; py < 8; py++) for (let qx = 0; qx < 8; qx++) {
        const X = mx + x * 8 + qx, Y = my + y * 8 + py;
        if (mc) plot(X, Y, c === 'D' ? 2 : 3, mat.mcColor, false);
        else plot(X, Y, 1, c === 'D' ? 8 : mat.colors.T, false);
      }
    }
    for (let py = 0; py < 8; py++) for (let qx = 0; qx < 8; qx++) { // player arrow, rotated to face
      let ax = qx, ay = py;
      for (let k = 0; k < d.dir; k++) [ax, ay] = [ay, 7 - ax];
      const on = ARROW[ay][ax] === '#';
      plot(mx + d.x * 8 + qx, my + d.y * 8 + py, on ? 1 : 0, on ? 1 : -1, on); // white (hi-res) or MC1
    }
  }

  // Rasterise the map into 320x200 pixel values + per-pixel colour + column owner.
  // Hi-res: ink holds 0/1. Multicolor: ink holds the 2-bit value, duplicated across each pixel pair.
  function renderScene(map) {
    const ink = new Uint8Array(W * H), col = new Uint8Array(W * H), own = new Int16Array(W * H).fill(-1);
    const obj = new Uint8Array(W * H); // 1 where an object's ink landed
    const n = map.size, mc = map.mode === 'mc', mapBottom = (25 - statusRows(map)) * 8;
    let idx = -1;
    function plot(x, y, v, c, isObj) {
      if (x < 0 || y < 0 || x >= W || y >= mapBottom) return; // status rows stay clear
      const i = y * W + x;
      ink[i] = +v; if (c >= 0) col[i] = c; own[i] = idx; obj[i] = isObj ? 1 : 0;
    }
    const persp = map.persp || 'iso';
    if (persp !== 'iso') {
      if (persp === 'dungeon') renderDungeon(map.dungeon, plot, mc, 8, 8, true);
      else VIEW_RENDERERS[persp](map, plot, mc, i => { idx = i; });
      return { ink, col, own, obj };
    }
    for (let s = 0; s <= 2 * n - 2; s++) {
      for (let gx = Math.max(0, s - n + 1); gx <= Math.min(s, n - 1); gx++) {
        const gy = s - gx, c = map.cells[gy * n + gx];
        idx = gy * n + gx;
        if (c.m < 0) continue;
        const mat = MATERIALS[c.m];
        const sx = ORIGIN_X + (gx - gy) * 16, base = BASE_Y + (gx + gy) * 8;
        if (c.h === 0) drawBlock(plot, sx, base + 16, mat, mc, false);
        else for (let z = 0; z < c.h; z++) drawBlock(plot, sx, base - z * 16, mat, mc, true);
        if (c.o >= 0) drawObject(plot, OBJECTS[c.o], sx + 8 + (c.ox || 0), base + 16 - 16 * c.h - 8 + (c.oy || 0), mc);
      }
    }
    return { ink, col, own, obj };
  }

  // ------------------------------------------------------------ compositor
  const keyOf = g => Array.prototype.join.call(g, ',');
  const isZero = g => g.every(b => b === 0);
  function popcount(v) { v -= (v >> 1) & 0x55; v = (v & 0x33) + ((v >> 2) & 0x33); return (v + (v >> 4)) & 0x0f; }

  // Pack the 8x8 cell at (x0, y0) of a raster (ink/col/obj arrays, row length `stride`) into glyph
  // bytes and a colour RAM value. One colour per cell: in hi-res, terrain wins so objects over ground
  // read as carved silhouettes; in multicolor only "11" pixels use the cell colour, and an object wins.
  function encodeCell(r, stride, x0, y0, mc) {
    const g = new Uint8Array(8), counts = new Uint16Array(16), objCounts = new Uint16Array(16);
    if (mc) {
      for (let y = 0; y < 8; y++) for (let fx = 0; fx < 4; fx++) {
        const i = (y0 + y) * stride + x0 + fx * 2, v = r.ink[i];
        g[y] |= v << (6 - 2 * fx);
        if (v === 3) (r.obj[i] ? objCounts : counts)[r.col[i] & 7]++;
      }
    } else {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = (y0 + y) * stride + x0 + x;
        if (r.ink[i]) { g[y] |= 0x80 >> x; (r.obj[i] ? objCounts : counts)[r.col[i]]++; }
      }
    }
    let c = mc ? 0 : 1, cm = 0;
    const src = mc ? (objCounts.some(v => v) ? objCounts : counts) : (counts.some(v => v) ? counts : objCounts);
    for (let j = 0; j < 16; j++) if (src[j] > cm) { cm = src[j]; c = j; }
    return { bytes: g, color: mc ? 8 | (c & 7) : c };
  }

  // Finds a glyph's screen code, reusing an identical glyph or claiming a blank slot at $40+.
  // Mutates `chars`; code() returns -1 when no blank slot is left.
  function makeAllocator(chars) {
    const lookup = new Map(), free = [], allocated = [];
    for (let i = 0x40; i < 256; i++) {
      if (isZero(chars[i])) free.push(i);
      else if (!lookup.has(keyOf(chars[i]))) lookup.set(keyOf(chars[i]), i);
    }
    for (let i = 0; i < 0x40; i++) if (!lookup.has(keyOf(chars[i]))) lookup.set(keyOf(chars[i]), i);
    lookup.set(keyOf(new Uint8Array(8)), 0x20);
    return {
      allocated, freeTotal: free.length,
      code(g) {
        const k = keyOf(g);
        let idx = lookup.get(k);
        if (idx === undefined && free.length) {
          idx = free.shift(); chars[idx] = Uint8Array.from(g); lookup.set(k, idx); allocated.push(idx);
        }
        return idx === undefined ? -1 : idx;
      },
    };
  }
  function nearestGlyph(chars, g) {
    let best = 0x20, bd = 99;
    for (let j = 0; j < 256; j++) {
      let d = 0;
      for (let y = 0; y < 8; y++) d += popcount(chars[j][y] ^ g[y]);
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }

  // Turn the raster into screen codes + colours. Cells that match an existing glyph reuse it;
  // anything else is written into a free (blank) slot at $40+; overflow falls back to the nearest glyph.
  function composite(base, raster, map) {
    const mc = map.mode === 'mc';
    const chars = base.map(g => Uint8Array.from(g));
    const alloc = makeAllocator(chars);
    let overflow = 0;
    const screen = new Uint8Array(1000), color = new Uint8Array(1000);
    for (let cy = 0; cy < 25; cy++) for (let cx = 0; cx < 40; cx++) {
      const { bytes, color: c } = encodeCell(raster, W, cx * 8, cy * 8, mc);
      let idx = alloc.code(bytes);
      if (idx < 0) { idx = nearestGlyph(chars, bytes); overflow++; }
      screen[cy * 40 + cx] = idx;
      color[cy * 40 + cx] = c;
    }
    const { allocated, freeTotal } = alloc;
    const rows = statusRows(map), split = map.split !== false;
    statusLines(map).forEach((line, r) => {
      // {text} is reverse video — only meaningful with the ROM font, where $80-$FF are the inverses.
      const codes = [];
      let rev = false;
      for (const ch of line) {
        if (ch === '{') rev = true;
        else if (ch === '}') rev = false;
        else codes.push(asciiToScreen(ch) | (rev && split ? 0x80 : 0));
      }
      const row = 25 - rows + r, start = row * 40 + Math.floor((40 - Math.min(40, codes.length)) / 2);
      codes.slice(0, 40).forEach((code, k) => {
        screen[start + k] = code;
        color[start + k] = mc ? map.textColor & 7 : map.textColor; // colour RAM < 8 keeps text hi-res
      });
    });
    return { chars, screen, color, allocated, overflow, freeTotal };
  }

  // ----------------------------------------------------------------- tiles
  // A tile is a w x h block of cells, each { c: screen code, k: colour RAM value }.
  // Starter tiles are drawn with the map renderer's own block/object code, so they match it exactly.
  function starterTiles(chars, mode, persp = 'iso') {
    const mc = mode === 'mc', alloc = makeAllocator(chars);
    const make = (name, w, h, draw) => {
      const stride = w * 8, n = stride * h * 8;
      const r = { ink: new Uint8Array(n), col: new Uint8Array(n), obj: new Uint8Array(n) };
      draw((x, y, v, c, isObj) => {
        if (x < 0 || y < 0 || x >= stride || y >= h * 8) return;
        const i = y * stride + x;
        r.ink[i] = +v; if (c >= 0) r.col[i] = c; r.obj[i] = isObj ? 1 : 0;
      });
      const cells = [];
      for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
        const { bytes, color } = encodeCell(r, stride, cx * 8, cy * 8, mc);
        const code = alloc.code(bytes);
        cells.push({ c: code < 0 ? nearestGlyph(chars, bytes) : code, k: color });
      }
      return { name, w, h, cells };
    };
    const mat = name => MATERIALS.find(m => m.name === name);
    const objects = () => OBJECTS.map(ob => make(ob.name, 2, 3, p => drawObject(p, ob, 0, 0, mc)));
    const blocks = (w, h, draw) => ['Grass', 'Stone', 'Brick'].map(m => make(`${m} block`, w, h, p => draw(p, mat(m))));
    const none = { N: -1, E: -1, S: -1, W: -1 };
    const view = (name, rows) => make(name, 20, 16, p => renderDungeon({ size: rows.length, mat: 1, x: 2, y: rows.length - 1, dir: 0, rows }, p, mc, 0, 0, false));
    if (persp === 'military') return [
      make('Grass floor', 2, 2, p => drawMilitaryBlock(p, 0, 0, mat('Grass'), mc, 0)),
      ...blocks(2, 3, (p, m) => drawMilitaryBlock(p, 0, 0, m, mc, 8)), ...objects(),
    ];
    if (persp === 'oblique') return [
      make('Grass floor', 2, 2, p => drawObliqueBlock(p, 0, 0, mat('Grass'), mc, 0, none)),
      ...blocks(2, 3, (p, m) => drawObliqueBlock(p, 0, 0, m, mc, 1, none)), ...objects(),
    ];
    if (persp === 'side') return [
      make('Grass ground', 3, 1, p => drawSideBlock(p, 0, 8, mat('Grass'), mc, false)),
      ...blocks(3, 3, (p, m) => drawSideBlock(p, 0, 8, m, mc, true)), ...objects(),
    ];
    if (persp === 'dungeon') return [
      view('Corridor', ['#####', '##.##', '##.##', '##.##', '##.##']),
      view('Door ahead', ['#####', '#####', '##D##', '##.##', '##.##']),
      view('Junction', ['#####', '##.##', '#...#', '##.##', '##.##']),
    ];
    return [
      make('Grass floor', 4, 2, p => drawBlock(p, 0, 0, mat('Grass'), mc, false)),
      make('Water floor', 4, 2, p => drawBlock(p, 0, 0, mat('Water'), mc, false)),
      make('Grass cube', 4, 4, p => drawBlock(p, 0, 0, mat('Grass'), mc, true)),
      make('Stone cube', 4, 4, p => drawBlock(p, 0, 0, mat('Stone'), mc, true)),
      make('Brick cube', 4, 4, p => drawBlock(p, 0, 0, mat('Brick'), mc, true)),
      ...OBJECTS.map(ob => make(ob.name, 2, 3, p => drawObject(p, ob, 0, 0, mc))),
    ];
  }

  function tilesAsm(tiles) {
    const out = ['; APEXSCII tiles — per tile: width, height, screen codes (row by row), then colour RAM values'];
    const used = new Set();
    tiles.forEach((t, n) => {
      let label = 'tile_' + (t.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || n);
      while (used.has(label)) label += '_';
      used.add(label);
      out.push(`${label}:`, `    .byte ${t.w},${t.h}`);
      for (let y = 0; y < t.h; y++) out.push('    .byte ' + t.cells.slice(y * t.w, y * t.w + t.w).map(c => hex(c.c)).join(','));
      for (let y = 0; y < t.h; y++) out.push('    .byte ' + t.cells.slice(y * t.w, y * t.w + t.w).map(c => hex(c.k & 15)).join(','));
    });
    return out.join('\n') + '\n';
  }

  // Status bar: one line of the caption per row, 1-3 rows at the bottom of the screen.
  const statusLines = map => (map.caption || '').split('\n').slice(0, 3);
  const statusRows = map => Math.max(1, statusLines(map).length);

  // ------------------------------------------------- screens and exports
  // A map's status bar is drawn in the ROM font (via the raster split) unless the split is off;
  // screens that aren't maps can say how many ROM rows they have with romRows.
  const romRows = map => (map.romRows !== undefined ? map.romRows : map.split !== false ? statusRows(map) : 0);
  const screenRGB = (chars, screen, color, map, rom) => APEXSCII.screenRGB(chars, screen, color, { ...map, romRows: romRows(map) }, rom);
  const mapPrg = (chars, screen, color, map) => APEXSCII.screenPrg(chars, screen, color, { ...map, romRows: romRows(map) });

  function mapAsm(screen, color) {
    const out = ['; APEXSCII map — 40x25 screen codes then colour RAM values', 'map_screen:'];
    for (let r = 0; r < 25; r++) out.push('    .byte ' + Array.from(screen.slice(r * 40, r * 40 + 40), b => hex(b)).join(','));
    out.push('map_color:');
    for (let r = 0; r < 25; r++) out.push('    .byte ' + Array.from(color.slice(r * 40, r * 40 + 40), b => hex(b)).join(','));
    return out.join('\n') + '\n';
  }


  // ---------------------------------------------------------- hardware sprites
  // Sprites float over the character screen: their own colours, and no character slots used.
  // A sprite set is { mc1, mc2, frames: [Uint8Array(64)], list: [{ frame, x, y, color, mc, xx, yy }] },
  // with x/y in display pixels (0,0 = top-left of the 320x200 screen); sprite 0 is drawn on top.
  // Multicolor art is 12 columns x 21 rows of '.', 'a' (01 = $D025), 'b' (10 = the sprite's colour)
  // and 'c' (11 = $D026); hi-res art is 24 columns of '.' and '#'. Larger art is cut into frames,
  // left to right then top to bottom.
  function spriteFrames(art, mc) {
    const w = mc ? 12 : 24, cols = art[0].length / w, rows = art.length / 21;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || art.some(r => r.length !== art[0].length)) {
      throw new Error('sprite art must be a whole number of sprites');
    }
    const frames = [];
    for (let sr = 0; sr < rows; sr++) for (let sc = 0; sc < cols; sc++) {
      const f = new Uint8Array(64);
      for (let y = 0; y < 21; y++) for (let x = 0; x < w; x++) {
        const ch = art[sr * 21 + y][sc * w + x], v = mc ? '.abc'.indexOf(ch) : '.#'.indexOf(ch);
        if (v < 0) throw new Error(`bad sprite pixel "${ch}"`);
        if (mc) f[y * 3 + (x >> 2)] |= v << (6 - 2 * (x & 3));
        else if (v) f[y * 3 + (x >> 3)] |= 0x80 >> (x & 7);
      }
      frames.push(f);
    }
    return frames;
  }

  // Draw sprites over a 320x200 RGBA screen (from screenRGB) the way the VIC does.
  function overlaySprites(rgba, sprites) {
    const pal = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
    for (let i = sprites.list.length - 1; i >= 0; i--) {
      const s = sprites.list[i], f = sprites.frames[s.frame], sx = s.xx ? 2 : 1, sy = s.yy ? 2 : 1;
      for (let y = 0; y < 21; y++) for (let x = 0; x < 24; x++) {
        const byte = f[y * 3 + (x >> 3)];
        const c = s.mc ? [-1, sprites.mc1, s.color, sprites.mc2][(byte >> (6 - 2 * ((x & 7) >> 1))) & 3]
                       : (byte >> (7 - (x & 7))) & 1 ? s.color : -1;
        if (c < 0) continue;
        for (let dy = 0; dy < sy; dy++) for (let dx = 0; dx < sx; dx++) {
          const X = s.x + x * sx + dx, Y = s.y + y * sy + dy;
          if (X >= 0 && Y >= 0 && X < 320 && Y < 200) rgba.set(pal[c], (Y * 320 + X) * 4);
        }
      }
    }
    return rgba;
  }

  // A runnable PRG with sprites: APEXSCII's screen program, plus the sprite frames at $2000 (pointers
  // $80 up, stored at $07F8 with the screen) and a set-up routine after them that BASIC's SYS runs
  // first; it programs the VIC's sprite registers and then jumps into the screen program at $0810.
  function spritePrg(chars, screen, color, opts, sprites) {
    const DATA = 0x2000, n = sprites.list.length;
    if (n > 8) throw new Error('the VIC has only 8 sprites');
    const scr = new Uint8Array(1024);
    scr.set(screen.subarray(0, 1000));
    sprites.list.forEach((s, i) => { scr[1016 + i] = (DATA >> 6) + s.frame; });
    const base = APEXSCII.screenPrg(chars, scr, color, opts);
    const init = DATA + sprites.frames.length * 64, code = [];
    if (String(init).length !== 4) throw new Error('too many sprite frames for the SYS line'); // up to $270F
    const sta = (v, addr) => code.push(0xa9, v & 0xff, 0x8d, addr & 0xff, addr >> 8); // LDA #v : STA addr
    let msb = 0, mc = 0, xx = 0, yy = 0;
    sprites.list.forEach((s, i) => {
      const vx = s.x + 24, vy = s.y + 50; // VIC sprite coordinates of the screen's top-left corner
      sta(vx, 0xd000 + 2 * i); sta(vy, 0xd001 + 2 * i); sta(s.color, 0xd027 + i);
      if (vx > 255) msb |= 1 << i;
      if (s.mc) mc |= 1 << i;
      if (s.xx) xx |= 1 << i;
      if (s.yy) yy |= 1 << i;
    });
    sta(msb, 0xd010); sta(mc, 0xd01c); sta(xx, 0xd01d); sta(yy, 0xd017);
    sta(sprites.mc1, 0xd025); sta(sprites.mc2, 0xd026); sta((1 << n) - 1, 0xd015);
    code.push(0x4c, 0x10, 0x08); // JMP $0810
    const at = addr => 2 + addr - 0x0801, out = new Uint8Array(at(init + code.length));
    out.set(base);
    sprites.frames.forEach((f, k) => out.set(f, at(DATA + k * 64)));
    out.set(code, at(init));
    out.set(Array.from(String(init), ch => ch.charCodeAt(0)), at(0x0806)); // "10 SYS<init>" (4 digits)
    return out;
  }

  return Object.assign({}, APEXSCII, {
    MAX_H, MATERIALS, OBJECTS, DIRS, DIR_NAMES, charsetKey, statusRows, defaultMap, defaultDungeon, dungeonAt,
    renderScene, renderDungeon, composite, starterTiles, tilesAsm, screenRGB, mapPrg, mapAsm,
    spriteFrames, overlaySprites, spritePrg,
  });
});
