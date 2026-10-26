// Builds the runnable demo map for every perspective (hi-res and multicolor) into ./out:
//   node build.js
// Per view: -demo.prg (the default map with a ROM-font status bar; LOAD"*",8,1 then RUN)
// and -demo-map.asm (its screen codes and colour RAM). The character sets themselves are built
// in the apexscii submodule.
const fs = require('fs');
const path = require('path');
const APEX = require('./apex-core.js');

const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

for (const persp of Object.keys(APEX.PERSPECTIVES)) for (const mode of ['hires', 'mc']) {
  // Isometric keeps the original file names; the other views are tagged with the perspective.
  const tag = (persp === 'iso' ? '' : '-' + persp) + (mode === 'mc' ? '-mc' : '');
  const { glyphs } = APEX.buildDefault(mode, persp);
  const map = Object.assign(APEX.defaultMap(), { mode, persp });
  const comp = APEX.composite(glyphs, APEX.renderScene(map), map);
  const files = {
    [`apexscii${tag}-demo.prg`]: APEX.mapPrg(comp.chars, comp.screen, comp.color, map),
    [`apexscii${tag}-demo-map.asm`]: APEX.mapAsm(comp.screen, comp.color),
  };
  for (const [name, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(out, name), typeof data === 'string' ? data : Buffer.from(data));
  }
  console.log(`${(persp + ' ' + mode).padEnd(16)} demo uses ${comp.allocated.length}/${comp.freeTotal} free slots, ${comp.overflow} overflow`);
}
