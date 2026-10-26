// Showcase videos: one MP4 per perspective plus a reel of all five, rendered frame by frame with the
// editor's own renderer and compositor. Every frame is a real C64 screen (charset, screen and colour
// RAM, ROM-font status row); the hero moves smoothly because its glyphs are rebuilt each frame, the
// way C64 games draw software sprites.
//
//   node showcase/make.js [--rom <chargen file>] [--only iso,dungeon]
//
// Needs ffmpeg on the PATH. --rom points at a C64 chargen ROM (e.g. VICE's C64/chargen-901225-01.bin)
// so the status row shows the real ROM font; without it APEXSCII's own text glyphs stand in.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { once } = require('events');
const APEX = require('../apex-core.js');

const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const rom = opt('--rom') ? fs.readFileSync(opt('--rom')).subarray(0, 2048) : null;
const only = opt('--only') ? opt('--only').split(',') : Object.keys(APEX.PERSPECTIVES);
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const FPS = 25, SCALE = 2;
const FW = 384, FH = 272, BX = 32, BY = 35; // the framing VICE uses for PAL screenshots
const PAL = APEX.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
const TILE_FRAMES = 8;     // frames to walk one tile
const MOVE_FRAMES = 8;     // frames per dungeon move

// ---------------------------------------------------------------- video output
function encoder(file) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${FW}x${FH}`,
    '-r', String(FPS), '-i', '-', '-vf', `scale=${FW * SCALE}:${FH * SCALE}:flags=neighbor`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file]);
  ff.stderr.on('data', d => process.stderr.write(d));
  const done = once(ff, 'close');
  return {
    async write(buf) { if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain'); },
    async end() { ff.stdin.end(); const [code] = await done; if (code) throw new Error(`ffmpeg failed for ${file}`); },
  };
}

// One C64 frame (screen RGBA from APEX.screenRGB) inside its border, as RGB24.
function framed(rgba, border) {
  const buf = Buffer.alloc(FW * FH * 3), b = PAL[border];
  for (let i = 0; i < FW * FH; i++) buf.set(b, i * 3);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
    const s = (y * 320 + x) * 4, d = ((BY + y) * FW + BX + x) * 3;
    buf[d] = rgba[s]; buf[d + 1] = rgba[s + 1]; buf[d + 2] = rgba[s + 2];
  }
  return buf;
}

const stats = { frames: 0, overflow: 0 };
function renderMap(map) {
  const base = baseCharset(map.persp, map.mode);
  const comp = APEX.composite(base, APEX.renderScene(map), map);
  stats.frames++;
  if (comp.overflow) stats.overflow++;
  return framed(APEX.screenRGB(comp.chars, comp.screen, comp.color, map, rom), map.border);
}
const BASES = {};
const baseCharset = (persp, mode) => BASES[persp + mode] || (BASES[persp + mode] = APEX.buildDefault(mode, persp).glyphs);

// A title card in the perspective's own character set.
function titleCard(persp) {
  const chars = baseCharset(persp, 'hires'), screen = new Uint8Array(1000).fill(0x20), color = new Uint8Array(1000).fill(1);
  const line = (row, s, c) => {
    const col = (40 - s.length) >> 1;
    for (let k = 0; k < s.length; k++) { screen[row * 40 + col + k] = APEX.asciiToScreen(s[k]); color[row * 40 + col + k] = c; }
  };
  line(9, 'APEXSCII', 7);
  line(12, viewName(persp), 1);
  line(15, 'COMMODORE 64 CHARACTER SET', 15);
  line(17, 'HI-RES 8X8 AND MULTICOLOR 4X8', 12);
  return framed(APEX.screenRGB(chars, screen, color, { mode: 'hires', bg: 0, mc1: 0, mc2: 0, romRows: 0 }), 0);
}
const viewName = persp => APEX.PERSPECTIVES[persp].name.toUpperCase().replace('°', '');
const modeName = mode => (mode === 'mc' ? 'MULTICOLOR 4X8' : 'HI-RES 8X8');
// Status row: the view in reverse, the mode, and a counter; braces don't take a column.
const status = (persp, mode, extra) => `{${persp === 'dungeon' ? 'DUNGEON' : viewName(persp)}} ${modeName(mode)}${extra ? '  ' + extra : ''}`;

// ---------------------------------------------------------------- height-map scenes
// Where a step of +1 in gx or gy moves a sprite on screen, and which of two cells draws later.
const STEP = {
  iso: { gx: [16, 8], gy: [-16, 8], order: (x, y) => x + y },
  military: { gx: [8, 8], gy: [-8, 8], order: (x, y) => x + y },
  oblique: { gx: [16, 0], gy: [0, 16], order: (x, y) => y * 8 + x },
  side: { gx: [16, 0], gy: [-8, 8], order: (x, y) => y * 8 + x },
};
const HERO = APEX.OBJECTS.findIndex(o => o.name === 'Hero');
const WALKABLE = new Set(['Grass', 'Sand', 'Paving'].map(n => APEX.MATERIALS.findIndex(m => m.name === n)));

// Breadth-first route over flat, walkable, unoccupied ground.
function route(map, from, to) {
  const n = map.size, ok = (x, y) => {
    const c = x >= 0 && y >= 0 && x < n && y < n && map.cells[y * n + x];
    return c && WALKABLE.has(c.m) && c.h === 1 && (c.o < 0 || c.o === HERO);
  };
  const prev = new Map([[from.join(), null]]), queue = [from];
  while (queue.length) {
    const [x, y] = queue.shift();
    if (x === to[0] && y === to[1]) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = [x + dx, y + dy];
      if (ok(...k) && !prev.has(k.join())) { prev.set(k.join(), [x, y]); queue.push(k); }
    }
  }
  const path = [];
  for (let p = to; p; p = prev.get(p.join())) path.unshift(p);
  if (path[0].join() !== from.join()) throw new Error(`no route ${from} -> ${to}`);
  return path;
}

async function heightScene(persp, outs) {
  const base = APEX.defaultMap(), n = base.size, step = STEP[persp];
  const start = base.cells.findIndex(c => c.o === HERO);
  base.cells.forEach(c => { if (c.o === HERO) c.o = -1; });
  const map = mode => ({ ...JSON.parse(JSON.stringify(base)), persp, mode });
  const emit = async buf => { for (const o of outs) await o.write(buf); };

  // 1. The world builds: every column rises from flat ground, in a wave from the far corner.
  const BUILD = 70;
  for (let f = 0; f < BUILD; f++) {
    const m = map('hires');
    m.cells.forEach((c, i) => {
      const wave = f / 4 - ((i % n) + ((i / n) | 0)) * 0.45;
      const h = Math.max(0, Math.min(c.h, Math.floor(wave)));
      if (h < c.h) c.o = -1; // objects appear once their column is up
      c.h = h;
    });
    m.caption = status(persp, 'hires', 'BUILDING');
    await emit(renderMap(m));
  }

  // 2. The hero walks a loop of waypoints, hi-res first, then the same walk carries on in multicolor.
  const waypoints = [[start % n, (start / n) | 0], [6, 6], [7, 3], [3, 1], [start % n, (start / n) | 0]];
  let path = [];
  for (let k = 0; k + 1 < waypoints.length; k++) path = path.concat(route(base, waypoints[k], waypoints[k + 1]).slice(k ? 1 : 0));
  const WALK = 2 * 150;
  for (let f = 0; f < WALK; f++) {
    const mode = f < WALK / 2 ? 'hires' : 'mc', m = map(mode);
    const t = f / TILE_FRAMES, i = Math.floor(t) % (path.length - 1), frac = t - Math.floor(t);
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    // The sprite belongs to whichever cell draws later, offset back towards where it really is.
    const toNext = step.order(bx, by) > step.order(ax, ay);
    const [cx, cy] = toNext ? [bx, by] : [ax, ay], k = toNext ? frac - 1 : frac;
    const dx = (bx - ax) * step.gx[0] + (by - ay) * step.gy[0], dy = (bx - ax) * step.gx[1] + (by - ay) * step.gy[1];
    const cell = m.cells[cy * n + cx];
    cell.o = HERO;
    cell.ox = Math.round(dx * k / 2) * 2; // whole fat pixels, so multicolor frames stay clean
    cell.oy = Math.round(dy * k);
    m.caption = status(persp, mode, `STEPS ${String(Math.floor(t)).padStart(3, '0')}`);
    await emit(renderMap(m));
  }
}

// ---------------------------------------------------------------- dungeon scene
async function dungeonScene(outs) {
  const emit = async (buf, times) => { for (let k = 0; k < times; k++) for (const o of outs) await o.write(buf); };
  const map = APEX.defaultMap();
  map.persp = 'dungeon';
  const d = map.dungeon, open = (x, y) => APEX.dungeonAt(d, x, y) !== '#';
  const ahead = dir => [d.x + APEX.DIRS[dir][0], d.y + APEX.DIRS[dir][1]];
  const STONE = d.mat, BRICK = APEX.MATERIALS.findIndex(m => m.name === 'Brick');
  const show = async (mode, label) => {
    map.mode = mode;
    d.mat = mode === 'mc' ? BRICK : STONE; // multicolor half shows off the brick walls
    map.caption = status('dungeon', mode, label || `FACING ${APEX.DIR_NAMES[d.dir]}`);
    await emit(renderMap(map), MOVE_FRAMES);
  };
  // Look around first, then follow the right-hand wall through the maze.
  for (let k = 0; k < 4; k++) { await show('hires'); d.dir = (d.dir + 1) % 4; }
  const MOVES = 64;
  for (let k = 0; k < MOVES; k++) {
    const mode = k < MOVES / 2 ? 'hires' : 'mc', right = (d.dir + 1) % 4;
    if (open(...ahead(right))) d.dir = right;
    else if (!open(...ahead(d.dir))) { d.dir = (d.dir + 3) % 4; await show(mode); continue; }
    if (open(...ahead(d.dir))) { [d.x, d.y] = ahead(d.dir); }
    await show(mode);
  }
}

// ---------------------------------------------------------------- main
(async () => {
  const reel = encoder(path.join(outDir, 'apexscii-reel.mp4'));
  for (const persp of only) {
    const file = path.join(outDir, `apexscii-${persp}.mp4`), own = encoder(file), outs = [own, reel];
    const before = { ...stats };
    for (let k = 0; k < FPS * 1.6; k++) for (const o of outs) await o.write(titleCard(persp));
    if (persp === 'dungeon') await dungeonScene(outs); else await heightScene(persp, outs);
    await own.end();
    const frames = stats.frames - before.frames;
    console.log(`${persp.padEnd(9)} ${path.relative(process.cwd(), file)} · ${frames} rendered screens · ` +
      `${stats.overflow - before.overflow} with glyph overflow`);
  }
  await reel.end();
  console.log(`reel      ${path.relative(process.cwd(), path.join(outDir, 'apexscii-reel.mp4'))}`);
})().catch(e => { console.error(e); process.exit(1); });
