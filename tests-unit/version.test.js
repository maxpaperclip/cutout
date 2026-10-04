'use strict';
// The version is written in exactly one place: "version" in package.json.
// build.js stamps it into the page. These tests fail if a copy of the version
// (or a versioned filename) creeps back in somewhere it would go stale.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadAppModules } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

function srcFiles() {
  const js = fs.readdirSync(path.join(ROOT, 'src', 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join('src', 'js', f));
  return ['src/index.html', ...js];
}

test('version: one source of truth', async (t) => {
  await t.test('package.json has a plain x.y.z version and no second version field', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.equal(pkg.friendshapedVersion, undefined);
  });

  await t.test('package-lock.json agrees with package.json (use `npm version` to bump both)', () => {
    const lock = JSON.parse(read('package-lock.json'));
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
  });

  await t.test('src/ uses the __APP_VERSION__ placeholder instead of a written-out version', () => {
    for (const rel of srcFiles()) {
      const hits = read(rel).match(/(?:['"`]|\bv)\d+\.\d+\.\d+\b/g);
      assert.equal(hits, null, rel + ' contains a hard-coded version: ' + hits);
    }
    assert.match(read('src/index.html'), /<title>[^<]*__APP_VERSION__[^<]*<\/title>/);
    assert.match(read('src/js/01-helpers.js'), /const APP_VERSION = '__APP_VERSION__'/);
  });

  await t.test('APP_VERSION at runtime is the package.json version', () => {
    assert.equal(loadAppModules().APP_VERSION, pkg.version);
  });

  await t.test('the release file has a permanent name, with no version in it', () => {
    const versioned = fs.readdirSync(ROOT).filter((f) => /^FriendShaped-v.*\.html$/i.test(f));
    assert.deepEqual(versioned, []);
    for (const rel of ['build.js', 'scripts/copy-to-root.js', '.github/workflows/build.yml', 'README.md', 'BUILD.md']) {
      assert.doesNotMatch(read(rel), /FriendShaped-v|friendshapedVersion/, rel + ' still refers to a versioned filename');
    }
  });
});
