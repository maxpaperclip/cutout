'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');

// The font list lives in the browser code (03-fonts-runtime.js); read it out of the source rather than running it
const SRC = path.join(__dirname, '..', 'src');
const text = fs.readFileSync(path.join(SRC, 'js', '03-fonts-runtime.js'), 'utf8');
const grab = (name) => new Function('return ' + text.slice(text.indexOf('const ' + name + ' = ') + ('const ' + name + ' = ').length).split(/;\r?\n/)[0])();
const DEFS = grab('FONT_DEFS'), CATS = grab('FONT_CATEGORIES');
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'fonts', 'manifest.json'), 'utf8'));
const credits = fs.readFileSync(path.join(SRC, 'fonts', 'CREDITS.md'), 'utf8');
const keys = DEFS.map(d => d[0]);

test('fonts: the list and the files agree', async (t) => {
  await t.test('keys and labels are unique', () => {
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(new Set(DEFS.map(d => d[1].toLowerCase())).size, DEFS.length);
  });
  await t.test('every font is in a known category, and every category but Yours has fonts', () => {
    const ids = CATS.map(c => c[0]);
    DEFS.forEach(([k, , c]) => assert.ok(ids.includes(c), k + ' has category ' + c));
    ids.filter(c => c !== 'user').forEach(c => assert.ok(DEFS.some(d => d[2] === c), c + ' is empty'));
    assert.deepEqual(ids, ['sans', 'serif', 'script', 'display', 'decorative', 'international', 'user']);
  });
  await t.test('the manifest lists exactly the fonts in the list, and every file is there', () => {
    assert.deepEqual(Object.keys(manifest).sort(), keys.slice().sort());
    keys.forEach(k => {
      const f = path.join(SRC, manifest[k]);
      assert.ok(fs.existsSync(f) && fs.statSync(f).size > 1000, k + ' file');
    });
  });
  await t.test('every font has its license text and a line in CREDITS.md', () => {
    keys.forEach(k => {
      const l = path.join(SRC, 'fonts', 'licenses', k + '.txt');
      assert.ok(fs.existsSync(l) && fs.statSync(l).size > 200, k + ' license');
      assert.ok(credits.includes('| ' + k + ' |'), k + ' in CREDITS.md');
    });
  });
  await t.test('the keys saved drawings already use have not changed', () => {
    // A key is stored in every drawing that uses the font: never rename one
    ['inter', 'inter-xb', 'nunito-xb', 'fredoka', 'lora', 'lora-b', 'bungee', 'pacifico', 'marker', 'mono'].forEach(k => assert.ok(keys.includes(k), k));
    assert.ok(keys.includes('inter-xb'), 'the default font');
  });
  await t.test('the library stays a sensible size', () => {
    const bytes = keys.reduce((n, k) => n + fs.statSync(path.join(SRC, manifest[k])).size, 0);
    assert.ok(bytes < 2.5 * 1048576, 'fonts total ' + (bytes / 1048576).toFixed(1) + ' MB');
  });
});
