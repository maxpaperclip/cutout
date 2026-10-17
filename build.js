#!/usr/bin/env node
/**
 * Build script for FriendShaped.
 *
 * It reads everything under src/ and glues it into two things:
 *
 *   dist/FriendShaped.html     The "lite" single file: one self-contained HTML file that works from a USB stick or an
 *                        email attachment, with a small set of fonts built in ("lite" in src/fonts/builds.json).
 *   dist/site/           The hosted version: index.html plus a fonts/ folder holding every font. The page only
 *                        carries the few fonts it needs to start ("core" in src/fonts/builds.json); the rest are
 *                        fetched from fonts/ when a font is first used, and the browser keeps them. To publish,
 *                        upload the contents of dist/site/ to any static web host. It needs to be opened from a
 *                        web address (a file opened straight from disk can't fetch the fonts folder).
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
 *   node build.js            build dist/FriendShaped.html and dist/site/
 *   node build.js --watch    rebuild on any change under src/
 *   node build.js --minify   also minify the JS with esbuild, if installed
 */

const crypto = require('crypto');
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
const LITE_FILE = 'FriendShaped.html';
const SITE_DIR = 'site';
const VERSION_TOKEN = '__APP_VERSION__';
function stampVersion(text, where) {
  if (!text.includes(VERSION_TOKEN)) throw new Error(`[build] ${where} no longer contains ${VERSION_TOKEN}; the version would not be stamped in.`);
  return text.split(VERSION_TOKEN).join(PKG.version);
}

function readManifest() {
  const manifestPath = path.join(SRC, 'js', 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

const FONTS_SRC = path.join(SRC, 'fonts');
// Fonts every build must carry: the default font for text, and the one the wordmark is drawn in
const MUST_EMBED = ['inter-xb', 'bungee'];
function readFontLists() {
  const manifest = JSON.parse(fs.readFileSync(path.join(FONTS_SRC, 'manifest.json'), 'utf8'));
  const builds = JSON.parse(fs.readFileSync(path.join(FONTS_SRC, 'builds.json'), 'utf8'));
  const faces = JSON.parse(fs.readFileSync(path.join(FONTS_SRC, 'faces.json'), 'utf8'));   // each family's other weights and italics
  Object.keys(faces).forEach((fam) => {
    if (!manifest[fam]) throw new Error(`[build] "${fam}" in src/fonts/faces.json is not in src/fonts/manifest.json.`);
    faces[fam].forEach(([k]) => { if (!manifest[k]) throw new Error(`[build] "${k}" in src/fonts/faces.json is not in src/fonts/manifest.json.`); });
  });
  ['core', 'lite'].forEach((name) => {
    const keys = builds[name];
    if (!Array.isArray(keys)) throw new Error(`[build] src/fonts/builds.json has no "${name}" list.`);
    keys.forEach((k) => { if (!manifest[k]) throw new Error(`[build] "${k}" in builds.json "${name}" is not in src/fonts/manifest.json.`); });
    MUST_EMBED.forEach((k) => { if (!keys.includes(k)) throw new Error(`[build] builds.json "${name}" must include "${k}".`); });
  });
  return { manifest, builds, faces };
}

// The fonts built into the page: window.FONT_DATA, keyed by font name, base64 — what src/js/03-fonts-runtime.js
// finds at start-up. window.FONT_FACES lists every family's weights and italics (in both builds, since the single
// file has some faces of a family and the hosted page knows all of them). window.FONT_BASE says where the other
// fonts are fetched from ('' means nowhere: the single file only has the fonts that are built in).
function buildFontData(manifest, keys, fontBase, faces) {
  const entries = keys.map((key) => [key, fs.readFileSync(path.join(FONTS_SRC, path.basename(manifest[key]))).toString('base64')]);
  return `window.FONT_DATA=${JSON.stringify(Object.fromEntries(entries))};window.FONT_FACES=${JSON.stringify(faces)};window.FONT_BASE=${JSON.stringify(fontBase)};`;
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

// The two libraries the app runs on are built into the page from node_modules (pinned to exact versions in
// package.json and package-lock.json), not loaded from a CDN: nothing is fetched from anyone else's server, a
// compromised CDN can't change the app, and the single file works with no internet at all.
const LIBS = ['paper/dist/paper-core.min.js', 'opentype.js/dist/opentype.min.js'];
function readLibs() {
  return LIBS.map((rel) => {
    let file;
    try { file = require.resolve(rel); } catch (e) { throw new Error(`[build] ${rel} is missing; run \`npm ci\` first.`); }
    return fs.readFileSync(file, 'utf8');
  });
}

// Text inside <script>...</script> must not contain "</script" (it would end the script early) or "<!--" (which
// changes how the browser looks for the end). Our own code and the libraries don't; fail loudly if that changes.
function inlineScript(code, where) {
  if (/<\/script|<!--/i.test(code)) throw new Error(`[build] ${where} contains "</script" or "<!--", which can't be put inside a <script> as is.`);
  return code;
}

// The Content Security Policy: the page may only run its own scripts (each one named by its hash, so an injected
// <script> or onclick= would not run), may only fetch from where it was served (the fonts folder and version.json
// of the hosted build), and pictures may only come from data: and blob: URLs made in the page.
function cspFor(scripts) {
  const hashes = scripts.map((s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`).join(' ');
  return [
    "default-src 'none'",
    `script-src ${hashes}`,
    "style-src 'unsafe-inline'",   // the page sets style= on elements as it draws
    'img-src data: blob:',
    'font-src data: blob:',
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}

function buildPage({ html, css, appScript, fontDataScript, libs }) {
  const bodies = [
    ...libs.map((code, i) => inlineScript(code, LIBS[i])),
    inlineScript(fontDataScript, 'the font data'),
    inlineScript(stampVersion(appScript, 'src/js'), 'src/js'),
  ];
  const scripts = bodies.map((b) => `<script>${b}</script>`).join('\n');
  const csp = `<meta http-equiv="Content-Security-Policy" content="${cspFor(bodies)}">`;
  if (!html.includes('<!--CSP-->')) throw new Error('[build] src/index.html no longer contains <!--CSP-->; the page would have no Content Security Policy.');

  // NOTE: replacement uses a function, not a string, because the app code
  // itself uses `$` and `$$` as function names — a literal-string
  // replacement would trigger JS's special "$$"/"$&" substitution
  // patterns and silently corrupt the output.
  return html
    .replace('<!--CSP-->', () => csp)
    .replace('<!--STYLES-->', () => css)
    .replace('<!--SCRIPTS-->', () => scripts);
}

function build({ minify = false, outDir = OUT_DIR } = {}) {
  const start = Date.now();

  const html = stampVersion(fs.readFileSync(path.join(SRC, 'index.html'), 'utf8'), 'src/index.html');
  const css = buildStyles(minify);
  const appScript = buildAppScript(minify);
  const libs = readLibs();
  const { manifest, builds, faces } = readFontLists();
  const kb = (file) => (fs.statSync(file).size / 1024).toFixed(0);

  fs.mkdirSync(outDir, { recursive: true });

  // 1. The lite single file: only the lite fonts, nothing to fetch
  const liteFile = path.join(outDir, LITE_FILE);
  fs.writeFileSync(liteFile, buildPage({ html, css, appScript, libs, fontDataScript: buildFontData(manifest, builds.lite, '', faces) }), 'utf8');

  // 2. The hosted site: a small page, and every font as its own file for the page to fetch when it is needed
  const siteDir = path.join(outDir, SITE_DIR), siteFonts = path.join(siteDir, 'fonts');
  fs.rmSync(siteDir, { recursive: true, force: true });   // so a font taken out of the library doesn't linger
  fs.mkdirSync(siteFonts, { recursive: true });
  const siteFile = path.join(siteDir, 'index.html');
  // What a page already open checks to learn that a newer one exists (checkForUpdate, in src/js/12-ui-chrome.js), and the
  // caching rules for hosts that read a _headers file (Netlify, Cloudflare Pages): the page and version.json are never reused without asking.
  fs.writeFileSync(path.join(siteDir, 'version.json'), JSON.stringify({ version: PKG.version }) + '\n', 'utf8');
  fs.writeFileSync(path.join(siteDir, '_headers'), '/\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/version.json\n  Cache-Control: no-store\n', 'utf8');
  fs.writeFileSync(siteFile, buildPage({ html, css, appScript, libs, fontDataScript: buildFontData(manifest, builds.core, 'fonts/', faces) }), 'utf8');
  const keys = Object.keys(manifest);
  keys.forEach((k) => fs.copyFileSync(path.join(FONTS_SRC, path.basename(manifest[k])), path.join(siteFonts, path.basename(manifest[k]))));
  // The licenses travel with the fonts they cover
  fs.cpSync(path.join(FONTS_SRC, 'licenses'), path.join(siteFonts, 'licenses'), { recursive: true });
  fs.copyFileSync(path.join(FONTS_SRC, 'CREDITS.md'), path.join(siteFonts, 'CREDITS.md'));

  const fontsKb = keys.reduce((n, k) => n + fs.statSync(path.join(siteFonts, path.basename(manifest[k]))).size, 0) / 1024;
  console.log(`[build] wrote ${path.relative(__dirname, liteFile)} (${kb(liteFile)} KB, ${builds.lite.length} fonts built in) in ${Date.now() - start}ms`);
  console.log(`[build] wrote ${path.relative(__dirname, siteFile)} (${kb(siteFile)} KB) and ${keys.length} fonts in ${path.relative(__dirname, siteFonts)}/ (${fontsKb.toFixed(0)} KB)`);
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

module.exports = { build };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--watch')) {
    watch();
  } else {
    build({ minify: args.includes('--minify') });
  }
}
