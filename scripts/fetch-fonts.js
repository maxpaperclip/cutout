#!/usr/bin/env node
/* Fetches the fonts listed below from the open-source Fontsource packages on npm and puts them in src/fonts/:
     src/fonts/<key>.woff            the Latin-subset font (the picker's labels, categories and styles live in
                                     src/js/03-fonts-runtime.js, see BUILD.md)
     src/fonts/licenses/<key>.txt    the license text of each font family (its first face's key)
     src/fonts/CREDITS.md            a table of every font family, its package and license
   and (re)writes src/fonts/manifest.json. Run it with `node scripts/fetch-fonts.js` (needs internet and npm).
   To add a font: add a line to NEW_FONTS, run this, then add the font to FONT_DEFS. To add more weights or italics
   of a family: add lines to EXTRA_FACES (they share the family's license) and list them in the family's FONT_DEFS
   entry. The first ten fonts (EXISTING) were added by hand before this script existed; they are only listed so the
   manifest and credits stay complete. The Chinese font is made by scripts/subset-cjk.py. */
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
// More weights and italics of a family above: key, Fontsource package, weight, style ('normal' or 'italic').
// Keys are saved in drawings, so never rename one. Named <family>-<weight>, with an i after it for italic.
const EXTRA_FACES = [
  ['lato-100', 'lato', 100, 'normal'], ['lato-100i', 'lato', 100, 'italic'],
  ['lato-300', 'lato', 300, 'normal'], ['lato-300i', 'lato', 300, 'italic'],
  ['lato-400i', 'lato', 400, 'italic'],
  ['lato-700', 'lato', 700, 'normal'], ['lato-700i', 'lato', 700, 'italic'],
  ['lato-900', 'lato', 900, 'normal'], ['lato-900i', 'lato', 900, 'italic']
];
// The first fonts, added by hand: only their license texts and credits are fetched (the .woff files stay as they are)
const EXISTING = [['inter', 'inter'], ['inter-xb', 'inter'], ['nunito-xb', 'nunito'], ['fredoka', 'fredoka'], ['lora', 'lora'], ['lora-b', 'lora'],
  ['bungee', 'bungee'], ['pacifico', 'pacifico'], ['marker', 'permanent-marker'], ['mono', 'roboto-mono']];
const CJK = ['noto-sans-sc'];   // made by scripts/subset-cjk.py, which also fetches its license

// One download per Fontsource package, however many faces and licenses it supplies
function fetchPackage(pkg, job) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'font-'));
  try {
    cp.execFileSync('npm', ['pack', '@fontsource/' + pkg, '--silent'], { cwd: tmp, stdio: 'pipe' });
    const tgz = fs.readdirSync(tmp).find(f => f.endsWith('.tgz'));
    const want = job.faces.map(f => `package/files/${pkg}-latin-${f.weight}-${f.style}.woff`);
    cp.execFileSync('tar', ['-xzf', tgz].concat(want, ['package/LICENSE', 'package/package.json']), { cwd: tmp, stdio: 'pipe' });
    const bytes = {};
    job.faces.forEach((f, i) => { fs.copyFileSync(path.join(tmp, want[i]), path.join(FONTS, f.key + '.woff')); bytes[f.key] = fs.statSync(path.join(FONTS, f.key + '.woff')).size; });
    job.licenseKeys.forEach(k => fs.copyFileSync(path.join(tmp, 'package/LICENSE'), path.join(FONTS, 'licenses', k + '.txt')));
    const pj = JSON.parse(fs.readFileSync(path.join(tmp, 'package/package.json'), 'utf8'));
    return { pkg, license: pj.license || '?', version: pj.version, bytes };
  } catch (e) {
    return { pkg, error: String(e.message || e).split('\n')[0] };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

(async () => {
  const jobs = new Map();
  const job = pkg => { if (!jobs.has(pkg)) jobs.set(pkg, { faces: [], licenseKeys: [] }); return jobs.get(pkg); };
  NEW_FONTS.forEach(([key, pkg, weight]) => { const j = job(pkg); j.faces.push({ key, weight, style: 'normal' }); j.licenseKeys.push(key); });
  EXTRA_FACES.forEach(([key, pkg, weight, style]) => job(pkg).faces.push({ key, weight, style }));
  EXISTING.forEach(([key, pkg]) => job(pkg).licenseKeys.push(key));

  const results = [], queue = Array.from(jobs.entries());
  await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) { const [pkg, j] = queue.shift(); results.push(fetchPackage(pkg, j)); } }));
  const bad = results.filter(r => r.error);
  results.sort((a, b) => a.pkg.localeCompare(b.pkg));
  results.forEach(r => console.log(r.error ? 'FAILED ' + r.pkg + ': ' + r.error : 'ok ' + r.pkg + ' ' + r.license + ' ' + Object.entries(r.bytes).map(([k, n]) => k + ' ' + n).join(', ')));
  if (bad.length) { console.error(bad.length + ' package(s) failed; nothing else was written.'); process.exit(1); }

  const meta = {};   // package -> its version and license, for the credits table
  results.forEach(r => { meta[r.pkg] = r; });
  const keyed = EXISTING.map(([k, p]) => [k, p]).concat(NEW_FONTS.map(([k, p]) => [k, p]));
  const manifest = {};
  EXISTING.map(f => f[0]).concat(NEW_FONTS.map(f => f[0]), EXTRA_FACES.map(f => f[0]), CJK).forEach(k => { manifest[k] = 'fonts/' + k + '.woff'; });
  fs.writeFileSync(path.join(FONTS, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const rows = keyed.map(([k, pkg]) => `| ${k} | @fontsource/${pkg} ${meta[pkg].version} | ${meta[pkg].license} | licenses/${k}.txt |`);
  rows.push('| noto-sans-sc | Noto Sans SC, cut down by scripts/subset-cjk.py | OFL-1.1 | licenses/noto-sans-sc.txt |');
  fs.writeFileSync(path.join(FONTS, 'CREDITS.md'), [
    '# Font credits', '',
    'Every font here is open source and comes with its license text in `licenses/`. The fonts added by `scripts/fetch-fonts.js`',
    'are the Latin subsets published by [Fontsource](https://fontsource.org); see each license for the authors.',
    'The other weights and italics of a family (such as `lato-700i`) come from the same package and share its license.', '',
    '| Key | Source | License | License text |', '|---|---|---|---|', ...rows, ''
  ].join('\n'));
  console.log('Wrote manifest.json and CREDITS.md');
})();
