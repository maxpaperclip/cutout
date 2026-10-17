'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');

// The font list lives in the browser code (03-fonts-runtime.js). Run that real file with a few stand-ins for the browser,
// once as the single-file build would see it (only the built-in fonts) and once as the hosted build would (every font).
const SRC = path.join(__dirname, '..', 'src');
const runtimeSource = fs.readFileSync(path.join(SRC, 'js', '03-fonts-runtime.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'fonts', 'manifest.json'), 'utf8'));
const builds = JSON.parse(fs.readFileSync(path.join(SRC, 'fonts', 'builds.json'), 'utf8'));
const faces = JSON.parse(fs.readFileSync(path.join(SRC, 'fonts', 'faces.json'), 'utf8'));
const credits = fs.readFileSync(path.join(SRC, 'fonts', 'CREDITS.md'), 'utf8');

// Arrays made inside the vm have its own Array, which deepEqual treats as a different kind of thing
const plain = x => JSON.parse(JSON.stringify(x));
const WOFF = () => new Uint8Array([0x77, 0x4f, 0x46, 0x46, 1, 2, 3, 4]).buffer;
function loadRuntime({ base, builtIn, fetchImpl }) {
  const toasts = [], fetched = [];
  const sandbox = {
    console, Date, Promise, Math, Uint8Array, String, Array, Set, Map, setTimeout, clearTimeout, atob: globalThis.atob,
    window: { FONT_BASE: base, FONT_FACES: faces },
    FONT_DATA: Object.fromEntries(builtIn.map(k => [k, 'AAAA'])),
    opentype: { parse: () => ({ getAdvanceWidth: () => 1, getPath: () => ({ toPathData: () => '' }) }) },
    $: () => ({ setAttribute() {}, appendChild() {}, outerHTML: '' }), svgEl: () => ({}),
    document: { fonts: { add() {} } }, FontFace: class { load() { return Promise.resolve(); } },
    location: { protocol: 'https:' },
    textLayouts: new Map(), doc: { objects: [] }, refresh() {}, refreshAll() {},
    toast: (m) => toasts.push(m),
    fetch: (url) => { fetched.push(url); return (fetchImpl || (async () => ({ ok: true, arrayBuffer: async () => WOFF() })))(url); }
  };
  vm.createContext(sandbox);
  vm.runInContext(runtimeSource, sandbox, { filename: '03-fonts-runtime.js' });
  const names = ['FONT_DEFS', 'FONT_CATEGORIES', 'fonts', 'FAMILIES', 'nearestFace', 'boldToggled', 'italicToggled', 'faceForFamily', 'faceIsBold',
    'ensureFonts', 'fontLoaded', 'fontBytes', 'rawFontKeys', 'fontsWithin', 'DEFAULT_FONT'];
  vm.runInContext('globalThis.__rt = { ' + names.join(', ') + ' };', sandbox);
  return Object.assign(sandbox.__rt, { toasts, fetched, sandbox });
}
const hosted = loadRuntime({ base: 'fonts/', builtIn: builds.core });
const lite = loadRuntime({ base: '', builtIn: builds.lite });
const DEFS = hosted.FONT_DEFS, CATS = hosted.FONT_CATEGORIES;
const keys = Object.keys(hosted.fonts);   // every face
const familyKeys = DEFS.map(d => d[0]);

test('fonts: the list and the files agree', async (t) => {
  await t.test('keys and labels are unique', () => {
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(new Set(keys.map(k => hosted.fonts[k].label.toLowerCase())).size, keys.length);
    assert.equal(new Set(familyKeys).size, familyKeys.length);
  });
  await t.test('every family is in a known category, and every category but Yours has fonts', () => {
    const ids = CATS.map(c => c[0]);
    DEFS.forEach(([k, , c]) => assert.ok(ids.includes(c), k + ' has category ' + c));
    ids.filter(c => c !== 'user').forEach(c => assert.ok(DEFS.some(d => d[2] === c), c + ' is empty'));
    assert.deepEqual(plain(ids), ['sans', 'serif', 'script', 'display', 'decorative', 'international', 'user']);
  });
  await t.test('the manifest lists exactly the fonts in the list, and every file is there', () => {
    assert.deepEqual(Object.keys(manifest).sort(), keys.slice().sort());
    keys.forEach(k => {
      const f = path.join(SRC, manifest[k]);
      assert.ok(fs.existsSync(f) && fs.statSync(f).size > 1000, k + ' file');
    });
  });
  await t.test('every family has its license text and a line in CREDITS.md', () => {
    familyKeys.forEach(k => {
      const l = path.join(SRC, 'fonts', 'licenses', k + '.txt');
      assert.ok(fs.existsSync(l) && fs.statSync(l).size > 200, k + ' license');
      assert.ok(credits.includes('| ' + k + ' |'), k + ' in CREDITS.md');
    });
  });
  await t.test('the keys saved drawings already use have not changed', () => {
    // A key is stored in every drawing that uses the font: never rename one
    ['inter', 'inter-xb', 'nunito-xb', 'fredoka', 'lora', 'lora-b', 'bungee', 'pacifico', 'marker', 'mono', 'lato'].forEach(k => assert.ok(keys.includes(k), k));
    assert.equal(hosted.DEFAULT_FONT, 'inter-xb', 'the default font');
    // ... and the first ten stay what they were (weight and slant), or old text would change when opened
    const was = { inter: 400, 'inter-xb': 800, 'nunito-xb': 800, fredoka: 600, lora: 400, 'lora-b': 700, bungee: 400, pacifico: 400, marker: 400, mono: 400, lato: 400 };
    Object.entries(was).forEach(([k, w]) => { assert.equal(hosted.fonts[k].weight, w, k + ' weight'); assert.equal(hosted.fonts[k].italic, false, k + ' upright'); });
  });
  await t.test('the library stays a sensible size', () => {
    const size = k => fs.statSync(path.join(SRC, manifest[k])).size;
    const all = keys.reduce((n, k) => n + size(k), 0), liteBytes = builds.lite.reduce((n, k) => n + size(k), 0), coreBytes = builds.core.reduce((n, k) => n + size(k), 0);
    assert.ok(all < 25 * 1048576, 'all fonts total ' + (all / 1048576).toFixed(1) + ' MB');
    assert.ok(liteBytes < 0.6 * 1048576, 'the single file\'s fonts total ' + (liteBytes / 1048576).toFixed(2) + ' MB');
    assert.ok(coreBytes < 150 * 1024, 'the hosted page\'s built-in fonts total ' + Math.round(coreBytes / 1024) + ' KB');
  });
});

test('fonts: faces.json agrees with the files', async (t) => {
  await t.test('every face is a real file in the manifest, in a family of the list, with a real weight', () => {
    Object.entries(faces).forEach(([fam, list]) => {
      assert.ok(familyKeys.includes(fam), fam + ' is in FONT_DEFS');
      const seen = new Set([hosted.fonts[fam].weight + 'n']);
      list.forEach(([k, w, i]) => {
        assert.ok(manifest[k], k + ' in the manifest');
        assert.ok(w >= 100 && w <= 900 && w % 100 === 0, k + ' weight');
        const id = w + (i ? 'i' : 'n');
        assert.ok(!seen.has(id), fam + ' has two ' + id);
        seen.add(id);
      });
    });
  });
  await t.test('every file in the manifest is the first face of a family or one of its faces', () => {
    const used = new Set(familyKeys);
    Object.values(faces).forEach(list => list.forEach(([k]) => used.add(k)));
    assert.deepEqual(plain(Object.keys(manifest).filter(k => !used.has(k))), []);
  });
  await t.test('names follow <family>-<weight>[i], except the ones saved drawings already used', () => {
    const old = new Set(['inter-xb', 'lora-b']);
    Object.entries(faces).forEach(([fam, list]) => list.forEach(([k, w, i]) => {
      if (old.has(k)) return;
      assert.match(k, new RegExp('^' + (fam === 'nunito-xb' ? 'nunito' : fam) + '-' + w + (i ? 'i' : '') + '$'));
    }));
  });
});

test('fonts: which fonts each build carries', async (t) => {
  await t.test('builds.json lists real fonts, and the lite build includes the core', () => {
    ['core', 'lite'].forEach(n => builds[n].forEach(k => assert.ok(manifest[k], n + ': ' + k)));
    builds.core.forEach(k => assert.ok(builds.lite.includes(k), 'lite has ' + k));
    ['inter-xb', 'bungee'].forEach(k => ['core', 'lite'].forEach(n => assert.ok(builds[n].includes(k), n + ' has ' + k)));
  });
  await t.test('the single file has only its built-in fonts, whole families', () => {
    assert.deepEqual(plain(Object.keys(lite.fonts)).sort(), builds.lite.slice().sort());
    assert.deepEqual(plain(lite.FAMILIES.inter.faces), ['inter', 'inter-xb']);
    assert.deepEqual(plain(lite.FAMILIES.lora.faces), ['lora', 'lora-b']);
    assert.equal(lite.FAMILIES.lato, undefined);
  });
  await t.test('the hosted build has every font, and fetches the ones not built in', () => {
    assert.deepEqual(plain(Object.keys(hosted.fonts)).sort(), Object.keys(manifest).sort());
    assert.equal(hosted.fontLoaded('bungee'), true);
    assert.equal(hosted.fontLoaded('lato-700'), false);
  });
});

test('fonts: families, weights and italics', async (t) => {
  await t.test('Lato has every weight and italic, lightest first', () => {
    assert.deepEqual(plain(hosted.FAMILIES.lato.faces), ['lato-100', 'lato-100i', 'lato-300', 'lato-300i', 'lato', 'lato-400i', 'lato-700', 'lato-700i', 'lato-900', 'lato-900i']);
    assert.equal(hosted.fonts['lato-700i'].styleLabel, 'Bold Italic');
    assert.equal(hosted.fonts['lato-400i'].styleLabel, 'Italic');
    assert.equal(hosted.fonts.lato.styleLabel, 'Regular');
    assert.equal(hosted.fonts['lato-900'].label, 'Lato Black');
  });
  await t.test('the Bold button swaps regular and bold, and keeps the slant', () => {
    assert.equal(hosted.boldToggled('lato'), 'lato-700');
    assert.equal(hosted.boldToggled('lato-700'), 'lato');
    assert.equal(hosted.boldToggled('lato-400i'), 'lato-700i');
    assert.equal(hosted.boldToggled('lato-700i'), 'lato-400i');
    assert.equal(hosted.boldToggled('lato-100'), 'lato-700');   // light counts as not bold
    assert.equal(hosted.boldToggled('lato-900'), 'lato');       // black counts as bold
    assert.equal(hosted.boldToggled('inter'), 'inter-700');
    assert.equal(hosted.boldToggled('inter-xb'), 'inter');
    assert.equal(hosted.boldToggled('lora'), 'lora-b');
  });
  await t.test('the Italic button swaps upright and italic, and keeps the weight', () => {
    assert.equal(hosted.italicToggled('lato'), 'lato-400i');
    assert.equal(hosted.italicToggled('lato-700'), 'lato-700i');
    assert.equal(hosted.italicToggled('lato-700i'), 'lato-700');
    assert.equal(hosted.italicToggled('lato-300'), 'lato-300i');
  });
  await t.test('a family without a style gets the same face back, so the button can switch itself off', () => {
    ['bungee', 'pacifico', 'bebas', 'lobster'].forEach(k => {
      assert.equal(hosted.italicToggled(k), k, k + ' italic');
      assert.equal(hosted.boldToggled(k), k, k + ' bold');
    });
    assert.equal(hosted.italicToggled('roboto-slab'), 'roboto-slab');   // bold, but no italic
    assert.equal(hosted.boldToggled('roboto-slab'), 'roboto-slab-700');
  });
  await t.test('families whose first face is not the regular one (Nunito, Fredoka) still have a regular and a bold', () => {
    assert.equal(hosted.boldToggled('nunito-xb'), 'nunito-400');
    assert.equal(hosted.boldToggled('nunito-400'), 'nunito-700');
    assert.equal(hosted.faceForFamily('nunito-xb', 'lato'), 'nunito-400');
    assert.equal(hosted.fonts['nunito-xb'].label, 'Nunito');
    assert.equal(hosted.fonts['nunito-xb'].styleLabel, 'Extra Bold');
    assert.equal(hosted.boldToggled('fredoka'), 'fredoka-400');     // 600 counts as bold
    assert.equal(hosted.boldToggled('fredoka-400'), 'fredoka-700');
  });
  await t.test('inter and lora got their bold faces under the keys they already had', () => {
    assert.equal(hosted.fonts['inter-xb'].family, 'inter');
    assert.equal(hosted.fonts['lora-b'].family, 'lora');
    assert.equal(hosted.italicToggled('inter'), 'inter-400i');
    assert.equal(hosted.italicToggled('lora-b'), 'lora-700i');
  });
  await t.test('picking another family keeps bold and italic where the family has them', () => {
    assert.equal(hosted.faceForFamily('lato', 'inter'), 'lato');
    assert.equal(hosted.faceForFamily('lato', 'inter-xb'), 'lato-700');   // the default text is bold
    assert.equal(hosted.faceForFamily('lora', 'lato-700'), 'lora-b');
    assert.equal(hosted.faceForFamily('lato', 'lora-b'), 'lato-700');
    assert.equal(hosted.faceForFamily('lato', 'lato-700i'), 'lato-700i');
    assert.equal(hosted.faceForFamily('lora', 'lato-700i'), 'lora-700i');
    assert.equal(hosted.faceForFamily('roboto', 'lato-900'), 'roboto-700');
    assert.equal(hosted.faceForFamily('bungee', 'lato-700i'), 'bungee');   // one face: nothing else to give
  });
  await t.test('the weight of every face is a real weight, and a family has one face per weight and slant', () => {
    Object.values(hosted.FAMILIES).forEach(F => {
      const seen = new Set();
      F.faces.forEach(k => {
        const f = hosted.fonts[k];
        assert.ok(f.weight >= 100 && f.weight <= 900 && f.weight % 100 === 0, k + ' weight');
        const id = f.weight + (f.italic ? 'i' : '');
        assert.ok(!seen.has(id), F.id + ' has two ' + id);
        seen.add(id);
        assert.equal(f.family, F.id);
      });
      assert.ok(F.faces.includes(F.id), F.id + ' lists its own regular face');
    });
  });
});

test('fonts: fetching a font that is not built in', async (t) => {
  await t.test('it is fetched from the fonts folder once, then kept', async () => {
    const rt = loadRuntime({ base: 'fonts/', builtIn: builds.core });
    assert.equal(await rt.ensureFonts(['lato-700i', 'lato-700i']), true);
    assert.equal(await rt.ensureFonts(['lato-700i']), true);
    assert.deepEqual(plain(rt.fetched), ['fonts/lato-700i.woff']);
    assert.equal(rt.fontLoaded('lato-700i'), true);
  });
  await t.test('a font that is built in is never fetched', async () => {
    const rt = loadRuntime({ base: 'fonts/', builtIn: builds.core });
    assert.equal(await rt.ensureFonts(['bungee', 'inter-xb']), true);
    assert.deepEqual(plain(rt.fetched), []);
  });
  await t.test('a failed fetch says so, says it once, and is tried again later', async () => {
    let ok = false;
    const rt = loadRuntime({ base: 'fonts/', builtIn: builds.core, fetchImpl: async () => { if (!ok) throw new Error('offline'); return { ok: true, arrayBuffer: async () => WOFF() }; } });
    assert.equal(await rt.ensureFonts(['lato']), false);
    assert.equal(await rt.ensureFonts(['lato-700']), false);
    assert.equal(rt.toasts.length, 1);
    assert.equal(rt.fontLoaded('lato'), false);
    ok = true;
    assert.equal(await rt.ensureFonts(['lato'], true), true);   // a person picking it again tries again straight away
    assert.equal(rt.fontLoaded('lato'), true);
  });
  await t.test('a page that is not a font (a host answering 200 with an error page) counts as failed', async () => {
    const rt = loadRuntime({ base: 'fonts/', builtIn: builds.core, fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('<!doctype html>').buffer }) });
    assert.equal(await rt.ensureFonts(['lato']), false);
    assert.equal(rt.fontLoaded('lato'), false);
  });
  await t.test('the single file never fetches', async () => {
    assert.equal(await lite.ensureFonts(['lato']), true);   // not a font it has: nothing to wait for
    assert.deepEqual(plain(lite.fetched), []);
  });
  await t.test('a drawing\'s text says which fonts it needs', () => {
    const raw = { objects: [{ kind: 'text', font: 'lato-700i' }, { kind: 'rect' }, { kind: 'text', font: 'no-such-font' }, { kind: 'text', font: 'inter' }, null] };
    assert.deepEqual(plain(hosted.rawFontKeys(raw)), ['lato-700i', 'inter']);
    assert.deepEqual(plain(hosted.rawFontKeys(null)), []);
  });
});

test('build: the two outputs', async (t) => {
  const { build } = require('../build.js');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'friendshaped-build-'));
  const log = console.log; console.log = () => {};
  try { build({ outDir: out }); } finally { console.log = log; }
  const dataOf = html => JSON.parse(/window\.FONT_DATA=(\{.*?\});window\.FONT_FACES=/s.exec(html)[1]);
  const baseOf = html => JSON.parse(/window\.FONT_BASE=("[^"]*")/.exec(html)[1]);
  await t.test('FriendShaped.html is one self-contained file with the lite fonts built in', () => {
    const html = fs.readFileSync(path.join(out, 'FriendShaped.html'), 'utf8');
    assert.deepEqual(Object.keys(dataOf(html)).sort(), builds.lite.slice().sort());
    assert.equal(baseOf(html), '');
  });
  await t.test('site/ is a small page plus a fonts folder with every font and its license', () => {
    const html = fs.readFileSync(path.join(out, 'site', 'index.html'), 'utf8');
    assert.deepEqual(Object.keys(dataOf(html)).sort(), builds.core.slice().sort());
    assert.equal(baseOf(html), 'fonts/');
    assert.ok(html.length < fs.statSync(path.join(out, 'FriendShaped.html')).size, 'the hosted page is lighter than the single file');
    Object.keys(manifest).forEach(k => assert.ok(fs.existsSync(path.join(out, 'site', 'fonts', k + '.woff')), k));
    familyKeys.forEach(k => assert.ok(fs.existsSync(path.join(out, 'site', 'fonts', 'licenses', k + '.txt')), k + ' license'));
    assert.ok(fs.existsSync(path.join(out, 'site', 'fonts', 'CREDITS.md')));
  });
  await t.test('the two pages differ only in their fonts', () => {
    // (and so in the hash of the script holding them, in the Content Security Policy)
    const strip = html => html.replace(/window\.FONT_DATA=.*?window\.FONT_BASE="[^"]*";/s, '').replace(/'sha256-[^']*'/g, '');
    assert.equal(strip(fs.readFileSync(path.join(out, 'FriendShaped.html'), 'utf8')), strip(fs.readFileSync(path.join(out, 'site', 'index.html'), 'utf8')));
  });
  await t.test('both pages run only their own built-in scripts, and fetch nothing from other servers', () => {
    const crypto = require('crypto');
    ['FriendShaped.html', path.join('site', 'index.html')].forEach(f => {
      const html = fs.readFileSync(path.join(out, f), 'utf8');
      assert.ok(!/<script[^>]+src=/i.test(html), f + ' loads a script from a file or server');
      assert.ok(!/(src|href)=["']?(https?:)?\/\//i.test(html), f + ' links to another server');
      const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
      assert.ok(csp, f + ' has a Content Security Policy');
      assert.ok(html.indexOf(csp[0]) < html.indexOf('<script'), f + ': the policy comes before the first script');
      const policy = Object.fromEntries(csp[1].split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
      assert.deepEqual(policy['default-src'], ["'none'"]);
      assert.deepEqual(policy['connect-src'], ["'self'"]);
      assert.deepEqual(policy['base-uri'], ["'none'"]);
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
      assert.equal(scripts.length, 4, f + ': paper.js, opentype.js, the fonts and the app');
      assert.ok(scripts[0].length > 100000 && scripts[1].length > 100000, f + ': the libraries are built in');
      const hashes = scripts.map(s => "'sha256-" + crypto.createHash('sha256').update(s, 'utf8').digest('base64') + "'");
      assert.deepEqual(policy['script-src'], hashes, f + ': the policy allows exactly the page\'s own scripts');
    });
  });
  fs.rmSync(out, { recursive: true, force: true });
});

test('fonts: keys read from a file can only name real fonts', async (t) => {
  const tricky = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  await t.test('names that every plain object has are not fonts', () => {
    tricky.forEach(k => {
      assert.equal(hosted.fonts[k], undefined, k);
      assert.equal(hosted.FAMILIES[k], undefined, k);
    });
  });
  await t.test('a drawing asking for them fetches nothing and changes no other object', async () => {
    const rt = loadRuntime({ base: 'fonts/', builtIn: builds.core, fetchImpl: async () => ({ ok: false, status: 404 }) });
    const raw = { objects: tricky.map(k => ({ kind: 'text', font: k, runs: [{ n: 1, f: k }] })) };
    assert.deepEqual(plain(rt.rawFontKeys(raw)), []);
    await rt.ensureFonts(tricky);
    assert.deepEqual(rt.fetched, []);
    assert.equal(vm.runInContext('({}).failedAt', rt.sandbox), undefined);
  });
});
