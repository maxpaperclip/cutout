#!/usr/bin/env node
/**
 * Build script for Cutout.
 *
 * Cutout ships as ONE self-contained HTML file so it can be dropped into any
 * classroom setup with zero server, zero install, and zero dependencies.
 * This script is what makes that possible while still letting you develop
 * against normal, separate files: it reads everything under src/ and glues
 * it back into a single dist/Cutout.html.
 *
 * Nothing here is a "real" module bundler (no import/export resolution).
 * The JS files under src/js/ share one global scope on purpose, in the
 * exact order given in src/js/manifest.json — that's how the app already
 * worked as one big <script>, so concatenating them in order reproduces
 * that behavior exactly. If you later want real ES modules, esbuild (or
 * any bundler) can replace the "concatenate JS" step below without
 * touching anything else in this file.
 *
 * Usage:
 *   node build.js            build dist/Cutout.html
 *   node build.js --watch    rebuild on any change under src/
 *   node build.js --minify   also minify the JS with esbuild, if installed
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT_DIR = path.join(__dirname, 'dist');
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
// The output always has the same name, so download links never change.
// The version lives in exactly one place, "version" in package.json. The
// build stamps it into the page wherever src/ says __APP_VERSION__ (the page
// title, and APP_VERSION in src/js/01-helpers.js). To release a new version:
//   npm version 1.7.0 --no-git-tag-version
// which updates package.json and package-lock.json together.
const OUT_FILE = path.join(OUT_DIR, 'Cutout.html');
const VERSION_TOKEN = '__APP_VERSION__';
function stampVersion(text, where) {
  if (!text.includes(VERSION_TOKEN)) throw new Error(`[build] ${where} no longer contains ${VERSION_TOKEN}; the version would not be stamped in.`);
  return text.split(VERSION_TOKEN).join(PKG.version);
}

function readManifest() {
  const manifestPath = path.join(SRC, 'js', 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function buildFontData() {
  // Every font listed in src/fonts/manifest.json becomes one entry in
  // window.FONT_DATA, keyed by name — exactly what
  // src/js/03-fonts-runtime.js expects to find at runtime. To add a new
  // embedded font: drop the .woff file in src/fonts/ and add a line here.
  const fontsDir = path.join(SRC, 'fonts');
  const manifest = JSON.parse(fs.readFileSync(path.join(fontsDir, 'manifest.json'), 'utf8'));
  const entries = Object.entries(manifest).map(([key, relPath]) => {
    const b64 = fs.readFileSync(path.join(fontsDir, path.basename(relPath))).toString('base64');
    return [key, b64];
  });
  const obj = Object.fromEntries(entries);
  return `window.FONT_DATA=${JSON.stringify(obj)};`;
}

function buildAppScript(minify) {
  const manifest = readManifest();
  let code = manifest
    .map((rel) => fs.readFileSync(path.join(SRC, rel), 'utf8'))
    .join('');

  // Sanity check every build, minified or not: if a section file has a
  // typo or an unbalanced brace, fail loudly here instead of shipping a
  // broken single-file app that only breaks in the browser.
  try {
    // eslint-disable-next-line no-new, no-new-func
    new Function(code);
  } catch (e) {
    throw new Error(`Concatenated app.js is not valid JavaScript: ${e.message}\nCheck the file boundaries in src/js/ — a section may be missing its closing brace.`);
  }

  if (minify) {
    try {
      // Optional: only used with --minify, and only if esbuild is installed.
      // eslint-disable-next-line global-require
      const esbuild = require('esbuild');
      const result = esbuild.transformSync(code, { minify: true, loader: 'js' });
      code = result.code;
    } catch (e) {
      console.warn('[build] --minify requested but esbuild is not installed; run `npm install` first. Shipping unminified JS instead.');
    }
  }
  return code;
}

function buildStyles(minify) {
  let css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
  if (minify) {
    try {
      // eslint-disable-next-line global-require
      const esbuild = require('esbuild');
      css = esbuild.transformSync(css, { minify: true, loader: 'css' }).code;
    } catch (e) {
      console.warn('[build] --minify requested but esbuild is not installed; shipping unminified CSS instead.');
    }
  }
  return css;
}

function build({ minify = false } = {}) {
  const start = Date.now();

  const html = stampVersion(fs.readFileSync(path.join(SRC, 'index.html'), 'utf8'), 'src/index.html');
  const css = buildStyles(minify);
  const fontDataScript = buildFontData();
  const appScript = buildAppScript(minify);

  const scripts = [
    '<script src="https://cdn.jsdelivr.net/npm/paper@0.12.18/dist/paper-core.min.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js"></script>',
    `<script>${fontDataScript}</script>`,
    `<script>${stampVersion(appScript, 'src/js')}</script>`,
  ].join('\n');

  // NOTE: replacement uses a function, not a string, because the app code
  // itself uses `$` and `$$` as function names — a literal-string
  // replacement would trigger JS's special "$$"/"$&" substitution
  // patterns and silently corrupt the output.
  const out = html
    .replace('<!--STYLES-->', () => css)
    .replace('<!--SCRIPTS-->', () => scripts);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, out, 'utf8');

  const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(0);
  console.log(`[build] wrote ${path.relative(__dirname, OUT_FILE)} (${kb} KB) in ${Date.now() - start}ms`);
}

function watch() {
  build({ minify: false });
  console.log('[build] watching src/ for changes... (Ctrl+C to stop)');
  let pending = false;
  fs.watch(SRC, { recursive: true }, () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      try {
        build({ minify: false });
      } catch (e) {
        console.error('[build] error:', e.message);
      }
    }, 100); // debounce rapid saves
  });
}

const args = process.argv.slice(2);
if (args.includes('--watch')) {
  watch();
} else {
  build({ minify: args.includes('--minify') });
}
