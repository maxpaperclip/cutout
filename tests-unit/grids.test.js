'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, a + ' is not within ' + eps + ' of ' + b);

test('grids: defaults and sanitizing', async (t) => {
  await t.test('a drawing that never set any grids gets the defaults, with both grids off', () => {
    const m = loadAppModules();
    const g = m.gridsOf(m.blankDoc());
    assert.equal(g.columns.show, false);
    assert.equal(g.baseline.show, false);
    assert.equal(g.columns.count, 12);
    assert.equal(g.baseline.size, 16);
    assert.equal(g.baseline.lh, 1.5);
  });

  await t.test('blankDoc carries no grids (older drawings and new ones look the same until a grid is used)', () => {
    const m = loadAppModules();
    assert.equal('grids' in m.blankDoc(), false);
  });

  await t.test('junk is replaced by defaults and numbers are kept in range', () => {
    const m = loadAppModules();
    const g = m.sanitizeGrids({ columns: { show: 1, count: 500, gutter: -3, left: 'x', opacity: 9, color: 'red' }, baseline: { size: 0, lh: 99, top: 80 } });
    assert.equal(g.columns.show, true);
    assert.equal(g.columns.count, 24);
    assert.equal(g.columns.gutter, 0);
    assert.equal(g.columns.left, 5, 'a non-number falls back to the default');
    assert.equal(g.columns.opacity, 1);
    assert.equal(g.columns.color, '#e5457a', 'a color that is not #rrggbb falls back');
    assert.equal(g.baseline.size, 4, 'no smaller than a text can be');
    assert.equal(g.baseline.lh, 3, 'no looser than a text can be');
    assert.equal(g.baseline.top, 45);
  });

  await t.test('the baseline only takes sizes and line heights a text can be set to (4 to 400 px, 0.6 to 3), so "Match baseline grid" always matches', () => {
    const m = loadAppModules();
    const lo = m.sanitizeGrids({ baseline: { size: -5, lh: 0 } }).baseline, hi = m.sanitizeGrids({ baseline: { size: 1e9, lh: 1e9 } }).baseline;
    assert.equal(lo.size, 4); assert.equal(lo.lh, 0.6);
    assert.equal(hi.size, 400); assert.equal(hi.lh, 3);
  });

  await t.test('non-objects give the defaults', () => {
    const m = loadAppModules();
    for (const bad of [null, undefined, 5, 'a', []]) assert.deepEqual(m.sanitizeGrids(bad), m.sanitizeGrids({}));
  });

  await t.test('margins and gutters can never leave the columns without width', () => {
    const m = loadAppModules();
    const g = m.sanitizeGrids({ columns: { count: 24, gutter: 20, left: 45, right: 45 } });
    assert.ok(g.columns.left + g.columns.right <= 90);
    const boxes = m.columnBoxes(g.columns, 1000);
    boxes.forEach(b => assert.ok(b.w > 0, 'every column has a positive width'));
    const tight = m.sanitizeGrids({ baseline: { top: 45, bottom: 45 } });
    assert.ok(tight.baseline.top + tight.baseline.bottom <= 90);
  });

  await t.test('sanitizing is idempotent', () => {
    const m = loadAppModules();
    const once = m.sanitizeGrids({ columns: { show: true, count: 7, gutter: 3.333, left: 12.345 }, baseline: { show: true, size: 13, lh: 1.37 } });
    assert.deepEqual(m.sanitizeGrids(once), once);
  });
});

test('grids: columns are percentages of the page', async (t) => {
  await t.test('columns, gutters and margins add up to the whole page width', () => {
    const m = loadAppModules();
    const c = m.sanitizeGrids({ columns: { count: 4, gutter: 2, left: 10, right: 5 } }).columns;
    const boxes = m.columnBoxes(c, 1000);
    assert.equal(boxes.length, 4);
    near(boxes[0].x, 100);                       // 10% left margin
    const last = boxes[3];
    near(last.x + last.w, 950);                  // 5% right margin
    near(boxes[1].x - (boxes[0].x + boxes[0].w), 20);   // 2% gutter
    const cw = boxes[0].w;
    boxes.forEach(b => near(b.w, cw));
  });

  await t.test('the same grid scales with the page: positions are in proportion to the width', () => {
    const m = loadAppModules();
    const c = m.sanitizeGrids({ columns: { count: 6, gutter: 1.5, left: 8, right: 8 } }).columns;
    const a = m.columnEdges(c, 800), b = m.columnEdges(c, 1600);
    assert.equal(a.length, b.length);
    a.forEach((x, i) => near(b[i], x * 2, 0.01));
  });

  await t.test('a column grid with no gutter lists each shared edge once', () => {
    const m = loadAppModules();
    const c = m.sanitizeGrids({ columns: { count: 4, gutter: 0, left: 0, right: 0 } }).columns;
    assert.deepEqual(Array.from(m.columnEdges(c, 400)), [0, 100, 200, 300, 400]);
  });

  await t.test('with a gutter every column has an edge on each side', () => {
    const m = loadAppModules();
    const c = m.sanitizeGrids({ columns: { count: 3, gutter: 5, left: 0, right: 0 } }).columns;
    assert.equal(m.columnEdges(c, 1000).length, 6);
  });

  await t.test('one column fills the space between the margins', () => {
    const m = loadAppModules();
    const c = m.sanitizeGrids({ columns: { count: 1, left: 10, right: 20 } }).columns;
    assert.deepEqual(Array.from(m.columnEdges(c, 1000)), [100, 800]);
  });

  await t.test('the path is one full-height vertical line per edge', () => {
    const m = loadAppModules();
    const c = m.sanitizeGrids({ columns: { count: 2, gutter: 0, left: 0, right: 0 } }).columns;
    assert.equal(m.columnGridPath(c, 200, 50), 'M0 0V50M100 0V50M200 0V50');
  });
});

test('grids: baseline grid', async (t) => {
  await t.test('lines are font size x line height apart, from the top margin to the bottom margin', () => {
    const m = loadAppModules();
    const b = m.sanitizeGrids({ baseline: { size: 10, lh: 2, top: 10, bottom: 10 } }).baseline;
    const ys = m.baselineYs(b, 200);
    assert.equal(m.baselineStep(b), 20);
    assert.equal(ys[0], 20);                    // 10% of 200
    assert.equal(ys[1], 40);
    assert.ok(ys[ys.length - 1] <= 180, 'nothing below the bottom margin');
    assert.ok(ys[ys.length - 1] > 160, 'and it goes right up to it');
  });

  await t.test('the margins are percentages of the page height, so they stretch with the page', () => {
    const m = loadAppModules();
    const b = m.sanitizeGrids({ baseline: { size: 10, lh: 1, top: 10, bottom: 20 } }).baseline;
    const r1 = m.baselineRange(b, 500), r2 = m.baselineRange(b, 1000);
    near(r1.y0, 50); near(r1.y1, 400);
    near(r2.y0, 100); near(r2.y1, 800);
    assert.equal(r1.step, r2.step, 'the spacing is a type size, so it stays the same');
  });

  await t.test('a tiny spacing never draws more than the line limit', () => {
    const m = loadAppModules();
    const b = m.sanitizeGrids({ baseline: { size: 4, lh: 0.6, top: 0, bottom: 0 } }).baseline;
    assert.ok(m.baselineYs(b, 8000).length <= m.GRID_MAX_LINES + 1);
  });

  await t.test('the path is one full-width horizontal line per baseline', () => {
    const m = loadAppModules();
    const b = m.sanitizeGrids({ baseline: { size: 10, lh: 2, top: 0, bottom: 0 } }).baseline;
    assert.equal(m.baselineGridPath(b, 300, 60), 'M0 0H300M0 20H300M0 40H300M0 60H300');
  });

  await t.test('nearestBaseline rounds to the closest line and stays within the margins', () => {
    const m = loadAppModules();
    const b = m.sanitizeGrids({ baseline: { size: 10, lh: 2, top: 10, bottom: 10 } }).baseline;
    assert.equal(m.nearestBaseline(b, 200, 29), 20);   // 29 is nearer 20 than 40
    assert.equal(m.nearestBaseline(b, 200, 31), 40);
    assert.equal(m.nearestBaseline(b, 200, -50), 20, 'above the grid: its first line');
    assert.ok(m.nearestBaseline(b, 200, 5000) <= 180, 'below the grid: its last line');
  });
});

test('grids: snapping', async (t) => {
  const withGrids = (m, grids) => { const d = m.blankDoc(); d.w = 1000; d.h = 1000; d.grids = m.sanitizeGrids(grids); return d; };

  await t.test('nothing snaps unless the grid is showing AND set to snap', () => {
    const m = loadAppModules();
    for (const g of [{ columns: { show: true, snap: false } }, { columns: { show: false, snap: true } }, {}]) {
      const d = withGrids(m, g);
      assert.equal(m.nearGuide(d, 'x', 50, 1000), null);
      assert.equal(m.gridSnapOn(d), false);
    }
  });

  await t.test('a point near a column edge snaps to it, a far one does not', () => {
    const m = loadAppModules();
    const d = withGrids(m, { columns: { show: true, snap: true, count: 2, gutter: 0, left: 0, right: 0 } });   // edges at 0, 500, 1000
    assert.equal(m.nearGuide(d, 'x', 497, 8), 500);
    assert.equal(m.nearGuide(d, 'x', 480, 8), null);
    assert.equal(m.gridSnapOn(d), true);
  });

  await t.test('columns pull only sideways and baselines only up and down', () => {
    const m = loadAppModules();
    const d = withGrids(m, { columns: { show: true, snap: true, count: 2, gutter: 0, left: 0, right: 0 } });
    assert.equal(m.nearGuide(d, 'y', 500, 8), null, 'a column grid has nothing to say about y');
    const e = withGrids(m, { baseline: { show: true, snap: true, size: 10, lh: 2, top: 0, bottom: 0 } });
    assert.equal(m.nearGuide(e, 'x', 20, 8), null, 'a baseline grid has nothing to say about x');
    assert.equal(m.nearGuide(e, 'y', 22, 8), 20);
  });

  await t.test('a moved object snaps by its near edge or its far edge, whichever is closer', () => {
    const m = loadAppModules();
    const d = withGrids(m, { columns: { show: true, snap: true, count: 2, gutter: 0, left: 0, right: 0 } });   // 0, 500, 1000
    near(m.guideShift(d, 'x', 303, 497, 8), 3);        // its right edge is 3 short of 500
    near(m.guideShift(d, 'x', 497, 700, 8), 3);        // its left edge is 3 short of 500
    assert.equal(m.guideShift(d, 'x', 200, 300, 8), null);
  });

  await t.test('nearGuide uses the page size of the drawing it is given', () => {
    const m = loadAppModules();
    const d = withGrids(m, { columns: { show: true, snap: true, count: 1, left: 10, right: 10 } });
    assert.equal(m.nearGuide(d, 'x', 101, 4), 100);
    d.w = 2000;
    assert.equal(m.nearGuide(d, 'x', 101, 4), null, 'the margin is now at 200');
    assert.equal(m.nearGuide(d, 'x', 201, 4), 200);
  });
});

test('grids: saving and opening', async (t) => {
  await t.test('sanitizeDoc keeps a drawing\'s grids and cleans them', () => {
    const m = loadAppModules();
    const d = m.sanitizeDoc({ w: 800, h: 600, objects: [], grids: { columns: { show: true, count: 6, gutter: 99 }, baseline: { show: true, size: 12 } } });
    assert.equal(d.grids.columns.show, true);
    assert.equal(d.grids.columns.count, 6);
    assert.ok(d.grids.columns.gutter < 20, 'out-of-range numbers are brought into range');
    assert.equal(d.grids.baseline.size, 12);
  });

  await t.test('a drawing without grids opens without them', () => {
    const m = loadAppModules();
    const d = m.sanitizeDoc({ w: 800, h: 600, objects: [] });
    assert.equal('grids' in d, false);
  });

  await t.test('grids survive the drawing\'s JSON round trip (what undo steps and project files are made of)', () => {
    const m = loadAppModules();
    const d = m.blankDoc();
    d.grids = m.sanitizeGrids({ columns: { show: true, count: 5 }, baseline: { show: true, lh: 1.25 } });
    const back = JSON.parse(m.docJSON(d));
    assert.deepEqual(m.gridsOf(back), d.grids);
  });

  await t.test('grids are not objects: they never appear in the object list or the exported SVG', () => {
    const m = loadAppModules();
    const d = m.blankDoc();
    d.grids = m.sanitizeGrids({ columns: { show: true }, baseline: { show: true } });
    assert.equal(d.objects.length, 0);
    const svg = m.buildSVG(d.objects, { x: 0, y: 0, w: 100, h: 100 });
    assert.ok(!/dasharray|grid/i.test(svg), 'nothing of the grids in the picture');
  });
});
