#!/usr/bin/env node
/* Fetches the fonts listed below from the open-source Fontsource packages on npm and puts them in src/fonts/:
     src/fonts/<key>.woff            the Latin-subset font (the picker's labels and categories live in
                                     src/js/03-fonts-runtime.js, see BUILD.md)
     src/fonts/licenses/<key>.txt    the font's license text
     src/fonts/CREDITS.md            a table of every font, its package and license
   and (re)writes src/fonts/manifest.json. Run it with `node scripts/fetch-fonts.js` (needs internet and npm).
   To add a font: add a line to NEW_FONTS, run this, then add the font to FONT_DEFS. The first ten fonts
   (EXISTING) were added by hand before this script existed; they are only listed so the manifest and credits
   stay complete. The Chinese font is made by scripts/subset-cjk.py. */
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const FONTS = path.join(__dirname, '..', 'src', 'fonts');

// key, Fontsource package, weight
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
// The first fonts, added by hand: only their license texts and credits are fetched (the .woff files stay as they are)
const EXISTING = [['inter', 'inter'], ['inter-xb', 'inter'], ['nunito-xb', 'nunito'], ['fredoka', 'fredoka'], ['lora', 'lora'], ['lora-b', 'lora'],
  ['bungee', 'bungee'], ['pacifico', 'pacifico'], ['marker', 'permanent-marker'], ['mono', 'roboto-mono']];
const CJK = ['noto-sans-sc'];   // made by scripts/subset-cjk.py, which also fetches its license

function fetchOne([key, pkg, weight], licenseOnly) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'font-'));
  try {
    cp.execFileSync('npm', ['pack', '@fontsource/' + pkg, '--silent'], { cwd: tmp, stdio: 'pipe' });
    const tgz = fs.readdirSync(tmp).find(f => f.endsWith('.tgz'));
    const want = `package/files/${pkg}-latin-${weight}-normal.woff`;
    cp.execFileSync('tar', ['-xzf', tgz].concat(licenseOnly ? [] : [want], ['package/LICENSE', 'package/package.json']), { cwd: tmp, stdio: 'pipe' });
    if (!licenseOnly) fs.copyFileSync(path.join(tmp, want), path.join(FONTS, key + '.woff'));
    fs.copyFileSync(path.join(tmp, 'package/LICENSE'), path.join(FONTS, 'licenses', key + '.txt'));
    const pj = JSON.parse(fs.readFileSync(path.join(tmp, 'package/package.json'), 'utf8'));
    return { key, pkg, license: pj.license || '?', version: pj.version, bytes: fs.statSync(path.join(FONTS, key + '.woff')).size };
  } catch (e) {
    return { key, pkg, error: String(e.message || e).split('\n')[0] };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

(async () => {
  const all = NEW_FONTS.map(f => [f, false]).concat(EXISTING.map(([k, pkg]) => [[k, pkg, 400], true]));
  const results = [], queue = all.slice();
  await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) { const [f, lo] = queue.shift(); results.push(fetchOne(f, lo)); } }));
  const bad = results.filter(r => r.error);
  const order = EXISTING.map(f => f[0]).concat(NEW_FONTS.map(f => f[0]));
  results.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  results.forEach(r => console.log(r.error ? 'FAILED ' + r.key + ' (' + r.pkg + '): ' + r.error : 'ok ' + r.key + ' ' + r.license + ' ' + r.bytes));
  if (bad.length) { console.error(bad.length + ' font(s) failed; nothing else was written.'); process.exit(1); }

  const manifest = {};
  EXISTING.map(f => f[0]).concat(NEW_FONTS.map(f => f[0]), CJK).forEach(k => { manifest[k] = 'fonts/' + k + '.woff'; });
  fs.writeFileSync(path.join(FONTS, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const rows = results.map(r => `| ${r.key} | @fontsource/${r.pkg} ${r.version} | ${r.license} | licenses/${r.key}.txt |`);
  rows.push('| noto-sans-sc | Noto Sans SC, cut down by scripts/subset-cjk.py | OFL-1.1 | licenses/noto-sans-sc.txt |');
  fs.writeFileSync(path.join(FONTS, 'CREDITS.md'), [
    '# Font credits', '',
    'Every font here is open source and comes with its license text in `licenses/`. The fonts added by `scripts/fetch-fonts.js`',
    'are the Latin subsets published by [Fontsource](https://fontsource.org); see each license for the authors.', '',
    '| Key | Source | License | License text |', '|---|---|---|---|', ...rows, ''
  ].join('\n'));
  console.log('Wrote manifest.json and CREDITS.md');
})();
