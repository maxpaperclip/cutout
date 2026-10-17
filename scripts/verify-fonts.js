#!/usr/bin/env node
/* Checks that the fonts in src/fonts/ are exactly what upstream publishes, so nobody has to take them on trust.
   For every family in src/fonts/CREDITS.md it downloads the Fontsource package and version listed there (npm pack,
   nothing is installed or run) and compares, byte for byte (SHA-256):
     - every face of the family in src/fonts/manifest.json with the package's Latin file for that weight and italic
       (the same naming scripts/fetch-fonts.js uses), and
     - licenses/<family>.txt with the package's LICENSE.
   A face that matches no file in its package is reported as a mismatch. The Chinese font (noto-sans-sc) is made by
   scripts/subset-cjk.py rather than copied, so only its license is checked here; to check the font itself, run
   that script and compare the result with git (`git diff --stat src/fonts/noto-sans-sc.woff`).
   Needs npm, tar and internet. Run: npm run verify:fonts   (exits 1 if anything doesn't match)
   See SECURITY-REVIEW.md for when this was last run and what else was checked. */
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const FONTS = path.join(__dirname, '..', 'src', 'fonts');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const manifest = JSON.parse(fs.readFileSync(path.join(FONTS, 'manifest.json'), 'utf8'));
const faces = JSON.parse(fs.readFileSync(path.join(FONTS, 'faces.json'), 'utf8'));
const rows = fs.readFileSync(path.join(FONTS, 'CREDITS.md'), 'utf8').split('\n')
  .map((l) => /^\| ([\w-]+) \| @fontsource\/([\w-]+) ([\d.]+) \|/.exec(l)).filter(Boolean)
  .map(([, key, pkg, version]) => ({ key, pkg, version }));

// The weight and slant of every face of a family: faces.json lists the others (including hand-named ones such as
// inter-xb and lora-b), and a family's first face is its regular weight unless fetch-fonts.js says otherwise
const FIRST_WEIGHT = { 'nunito-xb': 800, fredoka: 600 };
function facesOf(family) {
  const out = [{ key: family, weight: FIRST_WEIGHT[family] || 400, italic: false }];
  (faces[family] || []).forEach(([key, weight, italic]) => out.push({ key, weight, italic: !!italic }));
  return out;
}

let problems = 0, checked = 0;
const fail = (msg) => { problems++; console.log('  MISMATCH ' + msg); };
for (const fam of rows) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fontcheck-'));
  try {
    cp.execFileSync('npm', ['pack', `@fontsource/${fam.pkg}@${fam.version}`, '--silent'], { cwd: tmp, stdio: 'pipe' });
    const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    cp.execFileSync('tar', ['-xzf', tgz, '--wildcards', `package/files/${fam.pkg}-latin-*.woff`, 'package/LICENSE'], { cwd: tmp, stdio: 'pipe' });
    const upstream = (weight, italic) => path.join(tmp, 'package', 'files', `${fam.pkg}-latin-${weight}-${italic ? 'italic' : 'normal'}.woff`);
    const list = facesOf(fam.key);
    let ok = 0;
    for (const f of list) {
      checked++;
      if (!manifest[f.key]) { fail(`${f.key}: in faces.json but not in manifest.json`); continue; }
      const mine = path.join(FONTS, path.basename(manifest[f.key])), up = upstream(f.weight, f.italic);
      if (!fs.existsSync(up)) fail(`${f.key}: @fontsource/${fam.pkg}@${fam.version} has no Latin ${f.weight}${f.italic ? ' italic' : ''} file`);
      else if (sha(mine) !== sha(up)) fail(`${f.key}: differs from ${path.basename(up)} in @fontsource/${fam.pkg}@${fam.version}`);
      else ok++;
    }
    const lic = path.join(FONTS, 'licenses', fam.key + '.txt');
    if (sha(lic) !== sha(path.join(tmp, 'package', 'LICENSE'))) fail(`licenses/${fam.key}.txt differs from the package's LICENSE`);
    console.log(`${ok === list.length ? 'ok      ' : 'PROBLEM '} ${fam.key}: ${ok}/${list.length} face(s) identical to @fontsource/${fam.pkg}@${fam.version}`);
  } catch (e) {
    fail(`${fam.key}: could not download or read @fontsource/${fam.pkg}@${fam.version} (${String(e.message).split('\n')[0]})`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
// Every font in the manifest must belong to a family that was checked (or be the Chinese font, made by subset-cjk.py)
const covered = new Set(rows.flatMap((r) => facesOf(r.key).map((f) => f.key)).concat(['noto-sans-sc']));
Object.keys(manifest).filter((k) => !covered.has(k)).forEach((k) => fail(`${k}: in manifest.json but in no family listed in CREDITS.md`));
console.log(problems ? `\n${problems} problem(s) in ${checked} faces.` : `\nAll ${checked} faces and ${rows.length} licenses match upstream.`);
process.exit(problems ? 1 : 0);
