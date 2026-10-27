// Runs every demo map PRG in out/, the themed maps, the feature screens and the RPG mockups under VICE,
// and checks each screenshot pixel-for-pixel against the editor's own render (VICE's ROM font
// predicts the status rows).
//
//   node test/vice-check.js <path to VICE folder> [--ntsc] [--cycles 12000000,15000017]
//
// The VICE folder is the one holding bin/x64sc.exe (or bin/x64sc) and C64/. Run `node build.js` first.
const fs = require('fs'), os = require('os'), path = require('path');
const { findVice, screenshot, compare } = require('./vice-lib.js');

const args = process.argv.slice(2);
const viceDir = args.find(a => !a.startsWith('--') && !/^\d/.test(a));
const ntsc = args.includes('--ntsc');
const cyclesArg = args.indexOf('--cycles');
const cycles = cyclesArg >= 0 ? args[cyclesArg + 1].split(',') : ['12000000'];
if (!viceDir) { console.error('usage: node test/vice-check.js <VICE folder> [--ntsc] [--cycles N,N]'); process.exit(2); }

const repo = path.join(__dirname, '..');
const APEX = require(path.join(repo, 'apex-core.js'));
const { mockups } = require(path.join(repo, 'showcase', 'rpg.js'));
const features = require(path.join(repo, 'showcase', 'features.js')).screens;
const { exe, rom } = findVice(viceDir);
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-art-vice-'));

// Every screen to check: its PRG and the RGBA the editor predicts for it.
const screens = [];
for (const persp of Object.keys(APEX.PERSPECTIVES)) for (const mode of ['hires', 'mc']) {
  const tag = (persp === 'iso' ? '' : '-' + persp) + (mode === 'mc' ? '-mc' : '');
  const { glyphs } = APEX.buildDefault(mode, persp), map = Object.assign(APEX.defaultMap(), { mode, persp });
  const comp = APEX.composite(glyphs, APEX.renderScene(map), map);
  screens.push({ label: `${persp} ${mode}`, prg: path.join(repo, 'out', `apexscii${tag}-demo.prg`), border: map.border,
    rgba: APEX.screenRGB(comp.chars, comp.screen, comp.color, map, rom) });
}
// The same demo map in every other theme, built here rather than kept in out/.
for (const theme of Object.keys(APEX.THEMES).filter(t => t !== 'classic')) {
  for (const persp of Object.keys(APEX.PERSPECTIVES)) for (const mode of ['hires', 'mc']) {
    const { glyphs } = APEX.buildDefault(mode, persp, theme), art = APEX.THEME_ART[theme];
    const map = Object.assign(APEX.defaultMap(), { mode, persp, theme, mc1: art.mc1, mc2: art.mc2 });
    const comp = APEX.composite(glyphs, APEX.renderScene(map), map), prg = path.join(shots, `${theme}-${persp}-${mode}.prg`);
    fs.writeFileSync(prg, APEX.mapPrg(comp.chars, comp.screen, comp.color, map));
    screens.push({ label: `${theme} ${persp} ${mode}`, prg, border: map.border, rgba: APEX.screenRGB(comp.chars, comp.screen, comp.color, map, rom) });
  }
}
for (const f of features()) {
  const prg = path.join(shots, `${f.name}.prg`);
  fs.writeFileSync(prg, f.prg);
  screens.push({ label: f.name, prg, border: f.map.border, rgba: f.render(rom) });
}
for (const m of mockups()) {
  const prg = path.join(shots, `${m.name}.prg`);
  fs.writeFileSync(prg, m.prg);
  screens.push({ label: `rpg ${m.name}`, prg, border: m.opts.border, rgba: m.render(rom) });
}

let failures = 0;
for (const s of screens) for (const limit of cycles) {
  const label = `${s.label}${cycles.length > 1 ? ' @' + limit : ''}`.padEnd(28);
  const shot = path.join(shots, `${s.label.replace(/\W+/g, '-')}-${limit}.png`);
  if (!screenshot(exe, s.prg, shot, { ntsc, cycles: limit })) { console.log(`${label} no screenshot (did VICE start?)`); failures++; continue; }
  const r = compare(shot, s.rgba, s.border, APEX.PALETTE);
  console.log(`${label} ${r.bad ? `${r.bad} pixels differ, first at ${r.first}` : 'all 64000 pixels match'}` +
    `${r.borderOk ? '' : ' · border colour WRONG'}`);
  if (r.bad || !r.borderOk) failures++;
}
fs.rmSync(shots, { recursive: true, force: true });
console.log(failures ? `FAIL: ${failures} screen(s) differ` : `PASS: every screen matches the editor${ntsc ? ' (NTSC)' : ''}`);
process.exitCode = failures ? 1 : 0;
