'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

test('helpers: clamp', async (t) => {
  const m = loadAppModules();

  await t.test('keeps values already in range', () => {
    assert.equal(m.clamp(5, 0, 10), 5);
  });
  await t.test('clamps below the minimum', () => {
    assert.equal(m.clamp(-5, 0, 10), 0);
  });
  await t.test('clamps above the maximum', () => {
    assert.equal(m.clamp(15, 0, 10), 10);
  });
  await t.test('is inclusive of the bounds', () => {
    assert.equal(m.clamp(0, 0, 10), 0);
    assert.equal(m.clamp(10, 0, 10), 10);
  });
});

test('helpers: rnd (rounding to a given precision)', async (t) => {
  const m = loadAppModules();

  await t.test('rounds to 2 decimal places by default', () => {
    assert.equal(m.rnd(1.23456), 1.23);
  });
  await t.test('rounds to a custom precision', () => {
    assert.equal(m.rnd(1.23456, 3), 1.235);
    assert.equal(m.rnd(1.23456, 0), 1);
  });
  await t.test('rounds using the same semantics as Math.round (binary float caveats included)', () => {
    // NB: 1.005 is not exactly representable in binary floating point (it's
    // actually ~1.00499999999999989...), so the "textbook" expectation of
    // 1.01 is wrong for both rnd() and plain Math.round() here - this test
    // pins rnd() to whatever Math.round-based rounding actually does,
    // rather than to an intuition about decimal rounding.
    assert.equal(m.rnd(1.005, 2), Math.round(1.005 * 100) / 100);
    assert.equal(m.rnd(2.5, 0), 3);
    assert.equal(m.rnd(-2.5, 0), -2); // Math.round rounds -2.5 up, toward +Infinity
  });
});

test('helpers: esc (XML/HTML attribute escaping)', async (t) => {
  const m = loadAppModules();

  await t.test('escapes the five special characters used in attributes', () => {
    assert.equal(m.esc('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  });
  await t.test('leaves plain text untouched', () => {
    assert.equal(m.esc('hello world 123'), 'hello world 123');
  });
  await t.test('coerces non-string input to a string first', () => {
    assert.equal(m.esc(42), '42');
  });
});

test('helpers: rotPt (rotate a point about a center)', async (t) => {
  const m = loadAppModules();

  await t.test('a 0-degree rotation is a no-op', () => {
    const p = m.rotPt(10, 5, 0, 0, 0);
    assert.ok(Math.abs(p.x - 10) < 1e-9);
    assert.ok(Math.abs(p.y - 5) < 1e-9);
  });
  await t.test('rotating (10,0) by 90 degrees about the origin gives (0,10)', () => {
    const p = m.rotPt(10, 0, 0, 0, 90);
    assert.ok(Math.abs(p.x - 0) < 1e-9);
    assert.ok(Math.abs(p.y - 10) < 1e-9);
  });
  await t.test('rotating by 180 degrees mirrors through the center', () => {
    const p = m.rotPt(10, 10, 0, 0, 180);
    assert.ok(Math.abs(p.x + 10) < 1e-9);
    assert.ok(Math.abs(p.y + 10) < 1e-9);
  });
  await t.test('rotation is about the given center, not always the origin', () => {
    const p = m.rotPt(20, 10, 10, 10, 90);
    assert.ok(Math.abs(p.x - 10) < 1e-9);
    assert.ok(Math.abs(p.y - 20) < 1e-9);
  });
});

test('helpers: normDeg (normalize an angle to (-180, 180])', async (t) => {
  const m = loadAppModules();

  await t.test('leaves an already-normalized angle alone', () => {
    assert.equal(m.normDeg(45), 45);
    assert.equal(m.normDeg(-45), -45);
  });
  await t.test('wraps angles above 180', () => {
    assert.equal(m.normDeg(370), 10);
    assert.equal(m.normDeg(180 + 90), -90);
  });
  await t.test('wraps angles below -180', () => {
    assert.equal(m.normDeg(-370), -10);
  });
  await t.test('maps -180 to 180 (upper bound, not lower)', () => {
    assert.equal(m.normDeg(-180), 180);
  });
  await t.test('360 degrees normalizes to 0', () => {
    assert.equal(m.normDeg(360), 0);
  });
});
