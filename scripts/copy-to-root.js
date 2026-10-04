#!/usr/bin/env node
/**
 * Copies the finished build to the repo, so people can download it straight from GitHub:
 *   dist/Cutout.html  ->  Cutout.html   the lite single file, the download link teachers use
 *                                       (github.com/strawberrykoala/cutout/blob/main/Cutout.html)
 *   dist/site/        ->  site/         the hosted version: index.html plus the fonts/ folder with every font.
 *                                       Upload the contents of site/ to any static web host.
 * The names never change; the version number shown inside the app comes from "version" in package.json.
 * Run via `npm run release`, which runs the build first, then this copy step. (The font files in site/fonts/
 * are identical to the ones in src/fonts/, so git stores them only once.)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILENAME = 'Cutout.html';
const SITE = 'site';
const src = path.join(ROOT, 'dist', FILENAME);
const dest = path.join(ROOT, FILENAME);
const siteSrc = path.join(ROOT, 'dist', SITE);
const siteDest = path.join(ROOT, SITE);

for (const f of [src, siteSrc]) {
  if (!fs.existsSync(f)) {
    console.error(`[release] ${path.relative(ROOT, f)} not found — run "npm run build" first.`);
    process.exit(1);
  }
}

fs.copyFileSync(src, dest);
fs.rmSync(siteDest, { recursive: true, force: true });   // so a font taken out of the library doesn't linger
fs.cpSync(siteSrc, siteDest, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
console.log(`[release] copied ${FILENAME} and ${SITE}/ (v${version}) to the repo root. Review the diff, then commit them alongside your src/ changes.`);
