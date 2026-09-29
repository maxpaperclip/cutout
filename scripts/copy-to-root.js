#!/usr/bin/env node
/**
 * Copies dist/Cutout.html to the repo root, so the download link teachers use
 * (github.com/strawberrykoala/cutout/blob/main/Cutout.html) always points at
 * the latest release. The filename never changes; the version number shown
 * inside the app comes from "version" in package.json. Run via
 * `npm run release`, which runs the build first, then this copy step.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILENAME = 'Cutout.html';
const src = path.join(ROOT, 'dist', FILENAME);
const dest = path.join(ROOT, FILENAME);

if (!fs.existsSync(src)) {
  console.error(`[release] ${path.relative(ROOT, src)} not found — run "npm run build" first.`);
  process.exit(1);
}

fs.copyFileSync(src, dest);
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
console.log(`[release] copied ${FILENAME} (v${version}) to the repo root. Review the diff, then commit it alongside your src/ changes.`);
