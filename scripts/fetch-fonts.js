#!/usr/bin/env node
/* Fetches the fonts listed below from the open-source Fontsource packages on npm and puts them in src/fonts/:
     src/fonts/<key>.woff            a Latin-subset face: every weight and italic the package has, one file each
     src/fonts/licenses/<key>.txt    the license text of each font family (its first face's key)
     src/fonts/CREDITS.md            a table of every font family, its package and license
     src/fonts/faces.json            each family's other weights and italics: { family: [[key, weight, italic?], ...] }
   and (re)writes src/fonts/manifest.json. Run it with `node scripts/fetch-fonts.js` (needs internet and npm).
   The picker's labels and categories live in src/js/03-fonts-runtime.js (see BUILD.md).
   To add a font: add a line to NEW_FONTS, run this, then add the family to FONT_DEFS. Every weight and italic the
   package has comes with it, named <family>-<weight>, with an i after the weight for italic (lato-700i). The
   first faces (EXISTING) were added by hand before this script existed, some under other names (inter-xb): their
   keys never change, since saved drawings use them. The Chinese font is made by scripts/subset-cjk.py. */
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const FONTS = path.join(__dirname, '..', 'src', 'fonts');

// Family key (its first face), Fontsource package, weight of that face
const NEW_FONTS = [
  // sans
  ['roboto', 'roboto', 400], ['open-sans', 'open-sans', 400], ['montserrat', 'montserrat', 400], ['poppins', 'poppins', 400],
  ['lato', 'lato', 400], ['work-sans', 'work-sans', 400], ['lexend', 'lexend', 400], ['atkinson', 'atkinson-hyperlegible', 400],
  ['comic-neue', 'comic-neue', 400],
  // serif
  ['merriweather', 'merriweather', 400], ['playfair', 'playfair-display', 400], ['eb-garamond', 'eb-garamond', 400],
  ['baskerville', 'libre-baskerville', 400], ['source-serif', 'source-serif-4', 400], ['roboto-slab', 'roboto-slab', 400],
  ['cormorant', 'cormorant-garamond', 400],
  // script
  ['dancing', 'dancing-script', 400], ['lobster', 'lobster', 400], ['great-vibes', 'great-vibes', 400], ['satisfy', 'satisfy', 400],
  ['sacramento', 'sacramento', 400], ['caveat', 'caveat', 400], ['patrick-hand', 'patrick-hand', 400], ['kalam', 'kalam', 400],
  // display
  ['bebas', 'bebas-neue', 400], ['anton', 'anton', 400], ['oswald', 'oswald', 400], ['archivo-black', 'archivo-black', 400],
  ['abril', 'abril-fatface', 400], ['alfa-slab', 'alfa-slab-one', 400], ['righteous', 'righteous', 400], ['lilita', 'lilita-one', 400],
  ['cinzel', 'cinzel', 400],
  // decorative
  ['bangers', 'bangers', 400], ['luckiest', 'luckiest-guy', 400], ['creepster', 'creepster', 400], ['press-start', 'press-start-2p', 400],
  ['special-elite', 'special-elite', 400], ['pirata', 'pirata-one', 400], ['rye', 'rye', 400], ['orbitron', 'orbitron', 400],
  ['monoton', 'monoton', 400], ['chewy', 'chewy', 400]
];
// The first families, added by hand: key of the first face, package, its weight, and the other faces that already
// have a key of their own ({ weight: key }). Their .woff files stay as they are. prefix names the faces added since.
const EXISTING = [
  { key: 'inter', pkg: 'inter', weight: 400, named: { 800: 'inter-xb' } },
  { key: 'nunito-xb', pkg: 'nunito', weight: 800, named: {}, prefix: 'nunito' },
  { key: 'fredoka', pkg: 'fredoka', weight: 600, named: {} },
  { key: 'lora', pkg: 'lora', weight: 400, named: { 700: 'lora-b' } },
  { key: 'bungee', pkg: 'bungee', weight: 400, named: {} },
  { key: 'pacifico', pkg: 'pacifico', weight: 400, named: {} },
  { key: 'marker', pkg: 'permanent-marker', weight: 400, named: {} },
  { key: 'mono', pkg: 'roboto-mono', weight: 400, named: {} }
];
const CJK = ['noto-sans-sc'];   // made by scripts/subset-cjk.py, which also fetches its license

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One download per Fontsource package: finds every Latin weight and italic it has, and copies the ones not here yet
function fetchPackage(fam) {
  const pkg = fam.pkg, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'font-'));
  try {
    cp.execFileSync('npm', ['pack', '@fontsource/' + pkg, '--silent'], { cwd: tmp, stdio: 'pipe' });
    const tgz = fs.readdirSync(tmp).find(f => f.endsWith('.tgz'));
    const re = new RegExp('^package/files/' + esc(pkg) + '-latin-(\\d+)-(normal|italic)\\.woff$');
    const found = cp.execFileSync('tar', ['-tzf', tgz], { cwd: tmp, maxBuffer: 1 << 26 }).toString().split('\n')
      .map(l => re.exec(l.trim())).filter(Boolean).map(m => ({ weight: +m[1], italic: m[2] === 'italic', file: m[0] }));
    if (!found.some(f => f.weight === fam.weight && !f.italic)) throw new Error('no Latin ' + fam.weight + ' face');
    const prefix = fam.prefix || fam.key;
    found.forEach(f => {
      if (!f.italic && f.weight === fam.weight) f.key = fam.key;
      else if (!f.italic && fam.named && fam.named[f.weight]) f.key = fam.named[f.weight];
      else f.key = prefix + '-' + f.weight + (f.italic ? 'i' : '');
      f.fresh = !fam.existing || (f.key !== fam.key && !Object.values(fam.named || {}).includes(f.key));   // hand-added files stay untouched
    });
    found.sort((a, b) => a.weight - b.weight || +a.italic - +b.italic);
    const wanted = found.filter(f => f.fresh);
    cp.execFileSync('tar', ['-xzf', tgz].concat(wanted.map(f => f.file), ['package/LICENSE', 'package/package.json']), { cwd: tmp, stdio: 'pipe', maxBuffer: 1 << 26 });
    wanted.forEach(f => fs.copyFileSync(path.join(tmp, f.file), path.join(FONTS, f.key + '.woff')));
    fs.copyFileSync(path.join(tmp, 'package/LICENSE'), path.join(FONTS, 'licenses', fam.key + '.txt'));
    const pj = JSON.parse(fs.readFileSync(path.join(tmp, 'package/package.json'), 'utf8'));
    return { fam, license: pj.license || '?', version: pj.version, faces: found.map(f => ({ key: f.key, weight: f.weight, italic: f.italic })) };
  } catch (e) {
    return { fam, error: String(e.message || e).split('\n')[0] };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

(async () => {
  const families = EXISTING.map(f => Object.assign({ existing: true }, f))
    .concat(NEW_FONTS.map(([key, pkg, weight]) => ({ key, pkg, weight, named: {} })));
  const results = [], queue = families.slice();
  await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) results.push(fetchPackage(queue.shift())); }));
  const bad = results.filter(r => r.error);
  const order = families.map(f => f.key);
  results.sort((a, b) => order.indexOf(a.fam.key) - order.indexOf(b.fam.key));
  results.forEach(r => console.log(r.error ? 'FAILED ' + r.fam.key + ' (' + r.fam.pkg + '): ' + r.error : 'ok ' + r.fam.key + ' ' + r.license + ' ' + r.faces.length + ' face(s)'));
  if (bad.length) { console.error(bad.length + ' package(s) failed; nothing else was written.'); process.exit(1); }

  const manifest = {}, faces = {}, rows = [];
  results.forEach(r => {
    manifest[r.fam.key] = 'fonts/' + r.fam.key + '.woff';
    const others = r.faces.filter(f => f.key !== r.fam.key);
    others.forEach(f => { manifest[f.key] = 'fonts/' + f.key + '.woff'; });
    if (others.length) faces[r.fam.key] = others.map(f => f.italic ? [f.key, f.weight, 1] : [f.key, f.weight]);
    rows.push(`| ${r.fam.key} | @fontsource/${r.fam.pkg} ${r.version} | ${r.license} | licenses/${r.fam.key}.txt |`);
  });
  CJK.forEach(k => { manifest[k] = 'fonts/' + k + '.woff'; });
  fs.writeFileSync(path.join(FONTS, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(FONTS, 'faces.json'), '{\n' + Object.keys(faces).map(k => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(faces[k]).replace(/\],\[/g, '], [')).join(',\n') + '\n}\n');
  rows.push('| noto-sans-sc | Noto Sans SC, cut down by scripts/subset-cjk.py | OFL-1.1 | licenses/noto-sans-sc.txt |');
  fs.writeFileSync(path.join(FONTS, 'CREDITS.md'), [
    '# Font credits', '',
    'Every font here is open source and comes with its license text in `licenses/`. The fonts added by `scripts/fetch-fonts.js`',
    'are the Latin subsets published by [Fontsource](https://fontsource.org); see each license for the authors.',
    'The other weights and italics of a family (such as `lato-700i`) come from the same package and share its license.', '',
    '| Key | Source | License | License text |', '|---|---|---|---|', ...rows, ''
  ].join('\n'));
  console.log('Wrote manifest.json, faces.json and CREDITS.md');
})();
