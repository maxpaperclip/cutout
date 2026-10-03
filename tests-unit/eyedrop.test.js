'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCutoutModules } = require('./harness');

// RGBA pixels, w wide: rows of [r, g, b, a] lists
const px = (rows) => Uint8ClampedArray.from(rows.flat(2));
const R = [255, 0, 0, 255], B = [0, 0, 255, 255], C = [0, 0, 0, 0];

test('eyedropper: which part of the page is drawn', async (t) => {
  const m = loadCutoutModules();
  await t.test('the box is what the canvas shows, one picture pixel per screen pixel', () => {
    const r = m.dropRegion({ w: 800, h: 600 }, { x: 100, y: 50, z: 2 });
    assert.deepEqual({ ...r.box }, { x: -50, y: -25, w: 400, h: 300 });
    assert.equal(r.W, 800); assert.equal(r.H, 600); assert.equal(r.k, 1);
  });
  await t.test('a canvas with fractional size rounds the picture, not the box', () => {
    const r = m.dropRegion({ w: 800.4, h: 600.6 }, { x: 0, y: 0, z: 1 });
    assert.equal(r.W, 800); assert.equal(r.H, 601);
    assert.equal(r.box.w, 800.4);
  });
  await t.test('a huge canvas is drawn smaller, and points still land on the right pixel', () => {
    const r = m.dropRegion({ w: 4000, h: 4000 }, { x: 0, y: 0, z: 1 }, 4e6);
    assert.equal(r.k, 0.5); assert.equal(r.W, 2000); assert.equal(r.H, 2000);
    assert.deepEqual({ ...m.dropPixel(r, 1001, 7) }, { x: 500, y: 3 });
  });
  await t.test('points past the edge are held to it', () => {
    const r = m.dropRegion({ w: 10, h: 10 }, { x: 0, y: 0, z: 1 });
    assert.deepEqual({ ...m.dropPixel(r, -3, 99) }, { x: 0, y: 9 });
  });
});

test('eyedropper: reading the color', async (t) => {
  const m = loadCutoutModules();
  await t.test('one pixel is that pixel', () => {
    const d = px([[R, B]]);
    assert.deepEqual({ ...m.dropAverage(d, 2, 1, 1, 0, 1) }, { r: 0, g: 0, b: 255, a: 1 });
  });
  await t.test('3 x 3 averages the pixel and its eight neighbours', () => {
    const d = px([[R, R, B], [R, R, B], [R, R, B]]);   // six red, three blue
    const c = m.dropAverage(d, 3, 3, 1, 1, 3);
    assert.deepEqual([c.r, c.g, c.b, c.a], [170, 0, 85, 1]);
  });
  await t.test('at a corner only the pixels that exist count', () => {
    const d = px([[R, B], [B, B]]);
    const c = m.dropAverage(d, 2, 2, 0, 0, 3);   // one red, three blue
    assert.deepEqual([c.r, c.g, c.b], [64, 0, 191]);
  });
  await t.test('clear neighbours do not wash the color out', () => {
    const d = px([[C, C, C], [C, R, C], [C, C, C]]);
    const c = m.dropAverage(d, 3, 3, 1, 1, 3);
    assert.deepEqual([c.r, c.g, c.b], [255, 0, 0]);
    assert.ok(Math.abs(c.a - 1 / 9) < 1e-9);
  });
  await t.test('half-clear pixels weigh half as much', () => {
    const d = px([[R, [0, 0, 255, 128]]]);
    const c = m.dropAverage(d, 2, 1, 0, 0, 3);
    assert.deepEqual([c.r, c.b], [170, 85]);
  });
  await t.test('nothing there is reported as clear', () => {
    assert.equal(m.dropAverage(px([[C, C]]), 2, 1, 0, 0, 3).a, 0);
    assert.equal(m.dropAverage(px([[C, C]]), 2, 1, 0, 0, 1).a, 0);
  });
  await t.test('hex codes are lower case and padded', () => {
    assert.equal(m.dropHex({ r: 255, g: 0, b: 10 }), '#ff000a');
    assert.equal(m.dropHex({ r: 0, g: 171, b: 300 }), '#00abff');
  });
});
