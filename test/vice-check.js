// Runs every demo map PRG in out/ under VICE and checks each screenshot pixel-for-pixel against the
// editor's own render (with VICE's ROM font predicting the status bar).
//
//   node test/vice-check.js <path to VICE folder> [--ntsc] [--cycles 12000000,15000017]
//
// The VICE folder is the one holding bin/x64sc.exe (or bin/x64sc) and C64/. Run `node build.js` first.
// VICE uses its own palette, so each editor colour may map to exactly one VICE colour; any wrong
// character, colour or misplaced raster split shows up as differing pixels.
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const vice = args.find(a => !a.startsWith('--') && !/^\d/.test(a));
const ntsc = args.includes('--ntsc');
const cyclesArg = args.indexOf('--cycles');
const cycles = cyclesArg >= 0 ? args[cyclesArg + 1].split(',') : ['12000000'];
if (!vice) { console.error('usage: node test/vice-check.js <VICE folder> [--ntsc] [--cycles N,N]'); process.exit(2); }

const repo = path.join(__dirname, '..');
const APEX = require(path.join(repo, 'apex-core.js'));
const exe = ['x64sc.exe', 'x64sc'].map(f => path.join(vice, 'bin', f)).find(f => fs.existsSync(f));
const romFile = path.join(vice, 'C64', 'chargen-901225-01.bin');
if (!exe || !fs.existsSync(romFile)) { console.error(`x64sc or C64/chargen-901225-01.bin not found under ${vice}`); process.exit(2); }
const rom = fs.readFileSync(romFile).subarray(0, 2048);
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'apexscii-vice-'));

// Minimal PNG reader: 8-bit RGB, RGBA or palette images, which is what VICE writes.
function decodePng(buf) {
  let p = 8, w, h, depth, type, plte;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; }
    if (t === 'PLTE') plte = d;
    if (t === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  if (depth !== 8) throw new Error('unsupported PNG bit depth ' + depth);
  const bpp = { 2: 3, 3: 1, 6: 4 }[type], raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      px[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  const rgb = (x, y) => {
    const i = y * stride + x * bpp;
    return (type === 3 ? [plte[px[i] * 3], plte[px[i] * 3 + 1], plte[px[i] * 3 + 2]] : [px[i], px[i + 1], px[i + 2]]).join(',');
  };
  return { w, h, rgb };
}

const PAL = APEX.PALETTE.map(h => h.toLowerCase());
let failures = 0;
for (const persp of Object.keys(APEX.PERSPECTIVES)) for (const mode of ['hires', 'mc']) {
  const tag = (persp === 'iso' ? '' : '-' + persp) + (mode === 'mc' ? '-mc' : '');
  const prg = path.join(repo, 'out', `apexscii${tag}-demo.prg`);

  // What the editor predicts, as palette indices, with the real ROM font in the status rows.
  const { glyphs } = APEX.buildDefault(mode, persp), map = Object.assign(APEX.defaultMap(), { mode, persp });
  const comp = APEX.composite(glyphs, APEX.renderScene(map), map);
  const rgba = APEX.screenRGB(comp.chars, comp.screen, comp.color, map, rom);
  const want = Int8Array.from({ length: 64000 }, (_, i) =>
    PAL.indexOf('#' + [0, 1, 2].map(k => rgba[i * 4 + k].toString(16).padStart(2, '0')).join('')));

  for (const limit of cycles) {
    const label = `${persp} ${mode}${cycles.length > 1 ? ' @' + limit : ''}`.padEnd(28);
    const shot = path.join(shots, `shot${tag}-${limit}.png`);
    spawnSync(exe, ['-default', '-warp', '-sounddev', 'dummy', '+confirmonexit', '-autostartprgmode', '1',
      ...(ntsc ? ['-ntsc'] : []), '-limitcycles', limit, '-exitscreenshot', shot, '-autostart', prg], { timeout: 120000 });
    if (!fs.existsSync(shot)) { console.log(`${label} no screenshot (did VICE start?)`); failures++; continue; }

    const img = decodePng(fs.readFileSync(shot)), X0 = (img.w - 320) >> 1;
    const compare = Y0 => {
      const pair = new Map(), back = new Map();
      let bad = 0, first = null;
      for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
        const e = want[y * 320 + x], got = img.rgb(X0 + x, Y0 + y);
        if (!pair.has(e) && !back.has(got)) { pair.set(e, got); back.set(got, e); }
        if (pair.get(e) !== got) { bad++; first = first || `x${x} y${y} (cell ${x >> 3},${y >> 3})`; }
      }
      return { bad, first, back };
    };
    // PAL screenshots put the display 35 lines down; otherwise (NTSC) use the best-matching offset.
    let r = compare(35);
    if (r.bad) for (let oy = 0; oy + 200 <= img.h; oy++) { const t = compare(oy); if (t.bad < r.bad) r = t; }
    const border = img.rgb(4, 4), borderOk = !r.back.has(border) || r.back.get(border) === map.border;
    console.log(`${label} ${r.bad ? `${r.bad} pixels differ, first at ${r.first}` : 'all 64000 pixels match'}` +
      `${borderOk ? '' : ' · border colour WRONG'}`);
    if (r.bad || !borderOk) failures++;
  }
}
fs.rmSync(shots, { recursive: true, force: true });
console.log(failures ? `FAIL: ${failures} screen(s) differ` : `PASS: every demo matches the editor${ntsc ? ' (NTSC)' : ''}`);
process.exitCode = failures ? 1 : 0;
