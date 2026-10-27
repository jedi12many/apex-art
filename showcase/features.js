// Feature screens: the outline style, half-height steps and animation frames, as runnable PRGs and
// one comparison sheet.
//
//   node showcase/features.js [--rom <chargen file>]   writes showcase/out/feature-*.prg and features.png (needs ffmpeg)
//
// test/vice-check.js also loads screens() and checks every screen in VICE.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const APEX = require('../apex-core.js');

function screen(name, map, style = {}) {
  const glyphs = APEX.buildDefault(map.mode, map.persp || 'iso', map.theme || 'classic', style).glyphs;
  const comp = APEX.composite(glyphs, APEX.renderScene(map), map);
  return {
    name, map, comp,
    prg: APEX.mapPrg(comp.chars, comp.screen, comp.color, map),
    render: rom => APEX.screenRGB(comp.chars, comp.screen, comp.color, map, rom),
  };
}

// A staircase of half steps up to a 3.5-high landing, and a half-height ledge.
function stairs(persp) {
  const map = Object.assign(APEX.defaultMap(), { persp, mode: 'mc' });
  [1, 1.5, 2, 2.5, 3, 3.5].forEach((h, k) => Object.assign(map.cells[5 * 8 + 1 + k], { m: 1, h, o: -1 }));
  Object.assign(map.cells[6 * 8 + 3], { m: 1, h: 1.5, o: -1 });
  map.caption = `{HALF STEPS} ${persp === 'iso' ? 'ISOMETRIC' : 'SIDE OBLIQUE'}  MULTICOLOR`;
  return map;
}

function screens() {
  const crypt = frame => Object.assign(APEX.defaultMap(), { mode: 'mc', theme: 'crypt', frame,
    mc1: APEX.THEME_ART.crypt.mc1, mc2: APEX.THEME_ART.crypt.mc2, caption: `{ANIMATED} CRYPT  FRAME ${frame + 1} OF 4` });
  return [
    screen('feature-plain', Object.assign(APEX.defaultMap(), { mode: 'hires', caption: '{PLAIN} CLASSIC ISOMETRIC  HI-RES' })),
    screen('feature-outlined', Object.assign(APEX.defaultMap(), { mode: 'hires', outline: true, caption: '{OUTLINED} CLASSIC ISOMETRIC  HI-RES' }),
      { outline: true }),
    screen('feature-stairs-iso', stairs('iso')),
    screen('feature-stairs-side', stairs('side')),
    screen('feature-anim-1', crypt(0)),
    screen('feature-anim-3', crypt(2)),
  ];
}

module.exports = { screens };

if (require.main === module) {
  const args = process.argv.slice(2), romArg = args.indexOf('--rom');
  const rom = romArg >= 0 ? fs.readFileSync(args[romArg + 1]).subarray(0, 2048) : null;
  const out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  const PAL = APEX.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
  const all = screens(), FW = 384, FH = 272, COLS = 2, ROWS = Math.ceil(all.length / COLS);
  const sheet = Buffer.alloc(COLS * FW * ROWS * FH * 3);
  all.forEach((s, k) => {
    fs.writeFileSync(path.join(out, `${s.name}.prg`), s.prg);
    const rgba = s.render(rom), ox = (k % COLS) * FW, oy = ((k / COLS) | 0) * FH;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const inside = x >= 32 && x < 352 && y >= 35 && y < 235, p = ((y - 35) * 320 + (x - 32)) * 4;
      sheet.set(inside ? rgba.subarray(p, p + 3) : PAL[s.map.border], ((oy + y) * COLS * FW + ox + x) * 3);
    }
    console.log(`${s.name}: ${s.comp.allocated.length} free slots used, ${s.comp.overflow} overflow`);
  });
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${COLS * FW}x${ROWS * FH}`,
    '-i', '-', '-vf', `scale=iw*2:ih*2:flags=neighbor`, '-frames:v', '1', path.join(out, 'features.png')], { input: sheet });
  if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
}
