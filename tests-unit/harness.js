'use strict';
/*
 * Loads a subset of Cutout's actual src/js/*.js files into an isolated
 * Node `vm` context so their functions can be unit tested directly,
 * without a browser or DOM.
 *
 * Why this works: src/js files are plain (non-module) scripts, concatenated
 * by build.js into one shared scope. We reproduce just enough of that shared
 * scope - by running the real, unmodified file contents in a vm context -
 * plus minimal stubs for the handful of things that normally come from the
 * browser (paper.js, a `toast`/`commit` UI callback, etc).
 *
 * IMPORTANT: this loads the ACTUAL source files from src/js/. If you change
 * the logic in those files, these tests exercise your real change - nothing
 * here is a reimplementation or a mock of the app's own logic.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const paperFactory = require('paper');

const SRC_JS = path.join(__dirname, '..', 'src', 'js');

function readSrc(filename) {
  return fs.readFileSync(path.join(SRC_JS, filename), 'utf8');
}

// Files that contain pure-ish document/geometry/export/boolean-op logic,
// in the same order build.js would concatenate them. We deliberately don't
// load 00-preamble.js / 20-boot.js (they open/close the app's outer IIFE
// and touch the DOM directly) or the UI-wiring/rendering files (they assume
// a live document and canvas).
const MODULE_FILES = [
  '01-helpers.js',
  '04-document-model.js',
  '05-svg-export.js',
  '06-boolean-ops.js',
];

// Names we want pulled out of the loaded scripts' top-level scope so tests
// can call them directly. Keep this in sync with what a test file needs;
// it's harmless to list a name that a given test doesn't use.
const EXPORT_NAMES = [
  // 01-helpers.js
  'clamp', 'rnd', 'esc', 'rotPt', 'normDeg', 'APP_VERSION',
  // 04-document-model.js
  'blankDoc', 'newShape', 'refresh', 'buildPolygon', 'syncLineBox',
  'centerOf', 'aabb', 'unionBox', 'moveBy', 'labelOf', 'iconFor',
  'KIND_LABEL', 'byId', 'selObjs', 'one', 'hasPic', 'docImageIds',
  'hasGrad', 'makeGrad', 'cloneGrad', 'syncGradFill', 'gradAngle', 'setGradAngle',
  'reverseGrad', 'sanitizeGrad', 'shiftHue', 'normHex',
  // 05-svg-export.js
  'coverScale', 'picGeom', 'picCovers', 'shapeSpec', 'styleAttrs',
  'strokeAttrs', 'geomSpec', 'objXf', 'centerXf', 'ser', 'objToSVG',
  'buildSVG', 'rescalePic', 'drawOrigin', 'gradSpec', 'gradToSVG', 'serOpen',
  // 06-boolean-ops.js
  'combineShapes', 'replaceObjects', 'runBoolean', 'flattenSelected',
  'localPaper', 'worldPaper', 'lineToPaper', 'useAsMask', 'releaseMask',
  'fitPhoto', 'BOOL_NAME',
  // mutable state (04-document-model.js) - use with care; prefer passing
  // plain objects into pure functions where a test can. `images` and `doc`
  // are exposed because a few functions (iconFor/hasPic/useAsMask) read
  // them directly rather than taking them as arguments.
  'doc', 'S', 'images',
];

/**
 * Returns a fresh module namespace: a plain object exposing the functions
 * and mutable state (doc, S, images) from the real src/js files, isolated
 * from any other call to this function (separate vm context, separate
 * paper.js scope, separate `doc`).
 */
function loadCutoutModules({ recordToasts = false } = {}) {
  const paper = paperFactory;
  paper.setup(new paper.Size(16, 16));

  const toasts = [];
  const commits = [];

  const sandbox = {
    console,
    paper,
    Math,
    // The app's own toast()/commit() talk to the DOM and undo history.
    // For unit tests we just record calls so assertions can check
    // "did it try to notify the user / commit a change" without needing
    // a real UI.
    toast: (msg) => { if (recordToasts) toasts.push(msg); },
    commit: () => { commits.push(true); },
    // fontOf/DEFAULT_FONT normally come from 03-fonts-runtime.js, which
    // parses real embedded font binaries via opentype.js. We don't load
    // that file here (it's not pure logic worth unit-testing this way), but
    // newShape('text', ...) unconditionally calls refresh() -> buildText(),
    // which needs *some* font object to measure text against. This fake
    // font is just enough to make that path exercisable in tests that only
    // care about non-text-geometry fields (defaults, ids, fill, etc.) -
    // the actual glyph-outline math in buildText is real, this only fakes
    // the font data it operates on.
    DEFAULT_FONT: 'fake-test-font',
    fontOf: () => ({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      getAdvanceWidth: (text) => text.length * 500,
      getPath: () => ({ toPathData: () => 'M0 0L1 1Z' }),
    }),
    window: { crypto: (typeof crypto !== 'undefined') ? crypto : undefined },
  };
  vm.createContext(sandbox);

  const source = MODULE_FILES.map(readSrc).join('\n;\n');
  vm.runInContext(source, sandbox, { filename: 'cutout-src-bundle.js' });

  // A second script in the SAME context can see the first script's
  // top-level const/let/function bindings (this mirrors how multiple
  // classic <script> tags share one global lexical scope in a browser),
  // even though they never became properties of the sandbox object itself.
  // We use that to pull the names we want out into an explicit export bag.
  const exportScript = 'globalThis.__cutout_exports__ = { ' +
    EXPORT_NAMES.map((n) => `${n}: (typeof ${n} !== 'undefined' ? ${n} : undefined)`).join(', ') +
    ' };';
  vm.runInContext(exportScript, sandbox, { filename: 'cutout-src-exports.js' });

  const mod = sandbox.__cutout_exports__;
  mod._toasts = toasts;
  mod._commits = commits;
  mod._sandbox = sandbox; // escape hatch for anything not in EXPORT_NAMES
  return mod;
}

module.exports = { loadCutoutModules, MODULE_FILES, EXPORT_NAMES };
