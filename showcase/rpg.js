// RPG mockups for the first-person dungeon view: real C64 screens with a party panel, minimap and
// message log, and monsters/items as hardware sprites over the character graphics.
//
//   node showcase/rpg.js [--rom <chargen file>]   writes showcase/out/rpg-*.prg and rpg-*.png (needs ffmpeg)
//
// test/vice-check.js also loads mockups() and checks every screen in VICE.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const APEX = require('../apex-core.js');

const MODE = 'mc', CHAR_MC = { mc1: 12, mc2: 11 };
const ROM_ROWS = 5; // rows 20-24: the message log, in the ROM font

// Skeleton: 2x2 multicolor sprites (24x42 fat pixels), doubled to 96x84 on screen.
// b = bone (sprite colour), a = glowing eyes ($D025), c = dark outline ($D026).
const SKELETON = [
  '........cccccccc........', '......ccbbbbbbbbcc......', '.....cbbbbbbbbbbbbc.....', '.....cbbbbbbbbbbbbc.....',
  '.....cbcaacbbcaacbc.....', '.....cbcaacbbcaacbc.....', '.....cbbbbbccbbbbbc.....', '......cbbbbccbbbbc......',
  '......cbcbcbcbcbbc......', '.......cbbbbbbbbc.......', '........cccccccc........', '..........cbbc..........',
  '......cccccbbccccc......', '.....cbbbbbbbbbbbbc.....', '....cbbccbbbbbbccbbc....', '...cbbc.cbcbbcbc.cbbc...',
  '...cbc..ccbbbbcc..cbc...', '..cbbc..cbcbbcbc..cbbc..', '..cbc...ccbbbbcc...cbc..', '..cbc...cbcbbcbc...cbc..',
  '.cbbc...ccbbbbcc...cbbc.',
  '.cbc.....cbcbbc.....cbc.', '.cbc......cbbc......cbc.', 'cbbc......cbbc......cbbc', 'cbbbc....cbbbbc....cbbbc',
  '.ccc....cbbbbbbc....ccc.', '.......cbbccccbbc.......', '.......cbbc..cbbc.......', '........cbc..cbc........',
  '........cbc..cbc........', '........cbc..cbc........', '........cbc..cbc........', '.......cbbc..cbbc.......',
  '........cbc..cbc........', '........cbc..cbc........', '........cbc..cbc........', '........cbc..cbc........',
  '........cbc..cbc........', '.......cbbc..cbbc.......', '......cbbbc..cbbbc......', '.....cbbbbc..cbbbbc.....',
  '.....cccccc..cccccc.....',
];
// Treasure chest: one multicolor sprite, doubled. b = wood, a = gold bands and lock, c = outline.
const CHEST = [
  '............', '............', '............', '............', '..cccccccc..', '.cbbbbbbbbc.', 'cbbbbbbbbbbc',
  'cbbbbbbbbbbc', 'caaaaaaaaaac', 'cbbbbaabbbbc', 'cbbbbaabbbbc', 'cbbbbccbbbbc', 'cbbbbbbbbbbc', 'caaaaaaaaaac',
  'cbbbbbbbbbbc', 'cccccccccccc', '............', '............', '............', '............', '............',
];

const PARTY = [['KAEL', 'FIGHTER', 24, 30], ['MIRA', 'MAGE', 5, 18], ['TOBIN', 'CLERIC', 20, 22], ['VEX', 'THIEF', 15, 20]];

// One mockup screen: the dungeon view and minimap through the compositor, then text on top.
function screen({ name, at, dir, title, log, sprites }) {
  const { glyphs } = APEX.buildDefault(MODE, 'dungeon');
  const d = Object.assign(APEX.defaultDungeon(), { x: at[0], y: at[1], dir, mat: APEX.MATERIALS.findIndex(m => m.name === 'Brick') });
  const n = 320 * 200, raster = { ink: new Uint8Array(n), col: new Uint8Array(n), own: new Int16Array(n).fill(-1), obj: new Uint8Array(n) };
  const plot = (x, y, v, c, isObj) => {
    if (x < 0 || y < 0 || x >= 320 || y >= (25 - ROM_ROWS) * 8) return;
    const i = y * 320 + x;
    raster.ink[i] = +v; if (c >= 0) raster.col[i] = c; raster.obj[i] = isObj ? 1 : 0;
  };
  APEX.renderDungeon(d, plot, true, 8, 8, false);
  // Minimap: 4x4 pixels per maze square (two fat pixels), walls in MC1, doors in MC2, you in yellow.
  const MX = 31 * 8, MY = 11 * 8;
  for (let y = 0; y < d.size; y++) for (let x = 0; x < d.size; x++) {
    const c = APEX.dungeonAt(d, x, y), me = x === d.x && y === d.y;
    const v = me ? 3 : c === '#' ? 1 : c === 'D' ? 2 : 0;
    if (v) for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) plot(MX + x * 4 + px, MY + y * 4 + py, v, me ? 7 : -1, me);
  }
  const comp = APEX.composite(glyphs, raster, { mode: MODE, caption: '', split: false });
  const scr = comp.screen, col = comp.color;

  // Text: APEXSCII's own letters on the panel (colour RAM < 8 keeps them hi-res), ROM font below.
  const put = (row, c0, s, colour, rev) => {
    for (let k = 0; k < s.length; k++) { scr[row * 40 + c0 + k] = APEX.asciiToScreen(s[k]) | (rev ? 0x80 : 0); col[row * 40 + c0 + k] = colour; }
  };
  const putRich = (row, c0, s, colour) => { // {text} is reverse video (ROM rows only)
    let k = c0, rev = false;
    for (const ch of s) { if (ch === '{') rev = true; else if (ch === '}') rev = false; else put(row, k++, ch, colour, rev); }
  };
  const full = glyphs.findIndex(g => g.every(b => b === 0xff)), half = glyphs.findIndex(g => g.every(b => b === 0xf0));
  put(1, 22, 'THE PARTY', 7);
  PARTY.forEach(([who, cls, hp, max], k) => {
    put(3 + 2 * k, 22, who.padEnd(7) + cls, 1);
    const halves = Math.round(hp / max * 16), barColour = hp / max < 0.34 ? 2 : 5;
    put(4 + 2 * k, 22, 'HP', 3);
    for (let b = 0; b < 8; b++) {
      const v = Math.max(0, Math.min(2, halves - 2 * b));
      scr[(4 + 2 * k) * 40 + 25 + b] = v === 2 ? full : v === 1 ? half : APEX.asciiToScreen('.');
      col[(4 + 2 * k) * 40 + 25 + b] = v ? barColour : 3;
    }
    put(4 + 2 * k, 34, String(hp).padStart(2), 1);
  });
  put(12, 22, 'MAP', 7);
  put(14, 22, 'FACING', 3);
  put(15, 22, APEX.DIR_NAMES[d.dir], 1);
  put(17, 22, 'GOLD 125', 7);
  put(18, 22, 'FOOD  42', 7);
  put(18, 1, title, 3);
  log.forEach((line, k) => putRich(25 - ROM_ROWS + k, 1, line, k === 0 ? 7 : 1));

  const opts = { mode: MODE, bg: 0, border: 0, ...CHAR_MC, romRows: ROM_ROWS };
  return {
    name, chars: comp.chars, screen: scr, color: col, opts, sprites,
    prg: APEX.spritePrg(comp.chars, scr, col, opts, sprites),
    render: rom => APEX.overlaySprites(APEX.screenRGB(comp.chars, scr, col, opts, rom), sprites),
  };
}

function mockups() {
  const skeleton = APEX.spriteFrames(SKELETON, true), chest = APEX.spriteFrames(CHEST, true);
  const shared = { mc1: 7, mc2: 11 }; // $D025 yellow glow and gold, $D026 dark outline
  // The view is 160x128 from (8,8); its centre is x 88, and the floor at one square away is y 112.
  const big = (frame, x, y) => ({ frame, x, y, color: 1, mc: true, xx: true, yy: true });
  return [
    screen({
      name: 'rpg-combat', at: [8, 8], dir: 0, title: 'CRYPT OF AXE  LVL 1',
      sprites: { ...shared, frames: skeleton, list: [big(0, 40, 28), big(1, 88, 28), big(2, 40, 70), big(3, 88, 70)] },
      log: ['{ COMBAT }  ROUND 1', 'A SKELETON RISES FROM THE DUST!', 'IT STRIKES KAEL FOR 6 DAMAGE.', '',
        '{F}IGHT  {P}ARRY  {C}AST  {U}SE  {R}UN'],
    }),
    screen({
      name: 'rpg-treasure', ...deadEnd(), title: 'CRYPT OF AXE  LVL 1',
      sprites: { ...shared, frames: chest, list: [{ frame: 0, x: 64, y: 84, color: 8, mc: true, xx: true, yy: true }] },
      log: ['{ EXPLORE }', 'YOU FIND AN OLD CHEST.', 'THE LOCK IS RUSTED BUT HOLDS.', '',
        '{O}PEN  {S}EARCH  {M}OVE  {C}AMP'],
    }),
  ];
}

// A dead end one square ahead, walled in on three sides: a good place for treasure.
function deadEnd() {
  const d = APEX.defaultDungeon(), open = (x, y) => APEX.dungeonAt(d, x, y) !== '#';
  for (let y = 1; y < d.size - 1; y++) for (let x = 1; x < d.size - 1; x++) for (let dir = 0; dir < 4; dir++) {
    const [fx, fy] = APEX.DIRS[dir], [lx, ly] = APEX.DIRS[(dir + 3) % 4], nx = x + fx, ny = y + fy;
    if (open(x, y) && open(nx, ny) && !open(nx + fx, ny + fy) && !open(nx + lx, ny + ly) && !open(nx - lx, ny - ly)) {
      return { at: [x, y], dir };
    }
  }
  throw new Error('no dead end in the maze');
}

module.exports = { mockups };

if (require.main === module) {
  const args = process.argv.slice(2), romArg = args.indexOf('--rom');
  const rom = romArg >= 0 ? fs.readFileSync(args[romArg + 1]).subarray(0, 2048) : null;
  const out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  const PAL = APEX.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
  for (const m of mockups()) {
    fs.writeFileSync(path.join(out, `${m.name}.prg`), m.prg);
    // PNG at 2x inside the C64 border (the same framing as the videos).
    const rgba = m.render(rom), FW = 384, FH = 272, buf = Buffer.alloc(FW * FH * 3);
    for (let i = 0; i < FW * FH; i++) buf.set(PAL[m.opts.border], i * 3);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) buf.set(rgba.subarray((y * 320 + x) * 4, (y * 320 + x) * 4 + 3), ((35 + y) * FW + 32 + x) * 3);
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${FW}x${FH}`, '-i', '-',
      '-vf', `scale=${FW * 2}:${FH * 2}:flags=neighbor`, '-frames:v', '1', path.join(out, `${m.name}.png`)], { input: buf });
    if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
    console.log(`${m.name}: ${m.prg.length} byte PRG, ${m.sprites.list.length} sprites`);
  }
}
