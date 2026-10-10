'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');
const m = loadAppModules();
const plain = v => JSON.parse(JSON.stringify(v));
const split = w => { let o = '', p = 0; for (const n of m.hyphenPoints(w)) { o += w.slice(p, n) + '-'; p = n; } return o + w.slice(p); };

test('common words break where a dictionary would', () => {
  assert.equal(split('hyphenation'), 'hy-phen-ation');
  assert.equal(split('algorithm'), 'al-go-rithm');
  assert.equal(split('justification'), 'jus-ti-fi-ca-tion');
  assert.equal(split('beautiful'), 'beau-ti-ful');
  assert.equal(split('international'), 'in-ter-na-tional');
});

test('capital letters do not change where a word breaks', () => {
  assert.deepEqual(plain(m.hyphenPoints('Algorithm')), plain(m.hyphenPoints('algorithm')));
});

test('at least two letters stay before the hyphen and three after it', () => {
  for (const w of ['hyphenation', 'typography', 'programming', 'university', 'communication']) {
    for (const n of m.hyphenPoints(w)) {
      assert.ok(n >= m.HYPH_LEFT_MIN, w + ' left');
      assert.ok(w.length - n >= m.HYPH_RIGHT_MIN, w + ' right');
    }
  }
});

test('short words, capitals, and anything but plain letters are left whole', () => {
  assert.deepEqual(plain(m.hyphenPoints('into')), []);
  assert.deepEqual(plain(m.hyphenPoints('HEADLINE')), []);
  assert.deepEqual(plain(m.hyphenPoints("don't")), []);
  assert.deepEqual(plain(m.hyphenPoints('café')), []);
  assert.deepEqual(plain(m.hyphenPoints('abc123def')), []);
  assert.deepEqual(plain(m.hyphenPoints('')), []);
  assert.deepEqual(plain(m.hyphenPoints(null)), []);
});

test('the exception list wins over the patterns', () => {
  assert.equal(split('present'), 'present');
  assert.equal(split('project'), 'project');
  assert.equal(split('table'), 'ta-ble');
  assert.equal(split('associate'), 'as-so-ciate');
  assert.equal(split('democrat'), 'dem-o-crat');
});

test('a very long word still works and gives the same answer twice', () => {
  const w = 'pneumonoultramicroscopicsilicovolcanoconiosis';
  const a = plain(m.hyphenPoints(w));
  assert.ok(a.length > 5);
  assert.deepEqual(plain(m.hyphenPoints(w)), a);
});
