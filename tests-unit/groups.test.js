'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCutoutModules } = require('./harness');

const plain = (x) => JSON.parse(JSON.stringify(x));
// A drawing with objects A..F from bottom to top (ids 1..6)
function setup(n = 6) {
  const m = loadCutoutModules();
  const names = 'ABCDEFGHIJ'.slice(0, n).split('');
  names.forEach((nm, i) => m.doc.objects.push(m.newShape('rect', { name: nm, x: i * 100, y: 0, w: 50, h: 50 })));
  const byName = (nm) => m.doc.objects.find((o) => o.name === nm);
  const order = () => m.doc.objects.map((o) => o.name).join('');
  const sel = (s) => new Set(s.split('').map((nm) => byName(nm).id));
  return { m, byName, order, sel };
}

test('groups: making and taking apart', async (t) => {
  await t.test('grouping gathers the members together where the top one was', () => {
    const { m, order, sel, byName } = setup();
    const r = m.groupObjects(m.doc, sel('BE'));
    assert.ok(r.group);
    assert.equal(order(), 'ACDBEF');
    assert.equal(byName('B').parent, r.group.id);
    assert.equal(byName('E').parent, r.group.id);
    assert.equal(byName('A').parent, undefined);
  });

  await t.test('grouping needs two or more things', () => {
    const { m, sel } = setup();
    assert.match(m.groupObjects(m.doc, sel('B')).why, /two or more/);
    assert.match(m.groupObjects(m.doc, new Set()).why, /Select/);
    assert.equal(m.doc.groups.length, 0);
  });

  await t.test('groups nest, and a whole group counts as one thing', () => {
    const { m, sel, order } = setup();
    const inner = m.groupObjects(m.doc, sel('BC')).group;
    const outer = m.groupObjects(m.doc, sel('BCD')).group;   // group {B,C} + D
    assert.equal(inner.parent, outer.id);
    assert.equal(m.selectionUnits(m.doc, sel('BCD')).length, 1);
    assert.equal(m.selectionUnits(m.doc, sel('BC')).length, 1);
    assert.equal(m.selectionUnits(m.doc, sel('BD')).length, 2);
    assert.equal(order(), 'ABCDEF');
  });

  await t.test('grouping part of a group keeps the new group inside it', () => {
    const { m, sel } = setup();
    const outer = m.groupObjects(m.doc, sel('BCD')).group;
    const inner = m.groupObjects(m.doc, sel('CD')).group;
    assert.equal(inner.parent, outer.id);
  });

  await t.test('ungrouping moves what was inside up one level', () => {
    const { m, sel, byName } = setup();
    const inner = m.groupObjects(m.doc, sel('BC')).group;
    const outer = m.groupObjects(m.doc, sel('BCD')).group;
    assert.equal(m.ungroupObjects(m.doc, sel('BCD')), 1);   // the outer group
    assert.deepEqual(plain(m.doc.groups.map((g) => g.id)), [inner.id]);
    assert.equal(byName('B').parent, inner.id);
    assert.equal(byName('D').parent, undefined);
    assert.equal(m.ungroupObjects(m.doc, sel('A')), 0);
    void outer;
  });

  await t.test('clicking an object selects its whole outermost group', () => {
    const { m, sel, byName } = setup();
    m.groupObjects(m.doc, sel('BC'));
    m.groupObjects(m.doc, sel('BCD'));
    assert.deepEqual(plain(m.clickUnit(m.doc, byName('C')).map((o) => o.name)), ['B', 'C', 'D']);
    assert.deepEqual(plain(m.clickUnit(m.doc, byName('A')).map((o) => o.name)), ['A']);
  });
});

test('groups: tidying (normalizeGroups)', async (t) => {
  await t.test('empty groups are removed, including when their members are deleted', () => {
    const { m, sel } = setup();
    m.groupObjects(m.doc, sel('BC'));
    m.doc.objects = m.doc.objects.filter((o) => o.name !== 'B' && o.name !== 'C');
    m.normalizeGroups(m.doc);
    assert.equal(m.doc.groups.length, 0);
  });

  await t.test('broken links and loops are repaired', () => {
    const { m, byName } = setup(3);
    m.doc.groups = [{ id: 50, name: '', parent: 51 }, { id: 51, name: '', parent: 50 }, { id: 52, name: '', parent: 999 }];
    byName('A').parent = 50; byName('B').parent = 52; byName('C').parent = 777;
    m.normalizeGroups(m.doc);
    assert.equal(byName('C').parent, undefined);
    const g = (id) => m.doc.groups.find((x) => x.id === id);
    assert.equal(g(52).parent, null);
    assert.ok(g(50).parent === null || g(51).parent === null, 'the loop is broken');
  });

  await t.test('members that drifted apart are gathered back together', () => {
    const { m, byName, order } = setup();
    m.doc.groups = [{ id: 90, name: '', parent: null }];
    byName('A').parent = 90; byName('F').parent = 90;
    m.normalizeGroups(m.doc);
    assert.equal(order(), 'BCDEAF');
  });

  await t.test('tidying twice changes nothing', () => {
    const { m, sel } = setup();
    m.groupObjects(m.doc, sel('BD'));
    m.groupObjects(m.doc, sel('BDF'));
    const once = JSON.stringify(m.doc);
    m.normalizeGroups(m.doc);
    assert.equal(JSON.stringify(m.doc), once);
  });
});

test('groups: hidden and locked', async (t) => {
  await t.test('an object is hidden or locked when any group around it is', () => {
    const { m, sel, byName } = setup();
    const inner = m.groupObjects(m.doc, sel('BC')).group;
    const outer = m.groupObjects(m.doc, sel('BCD')).group;
    outer.hidden = true; inner.locked = true;
    assert.equal(m.effHidden(m.doc, byName('B')), true);
    assert.equal(m.effHidden(m.doc, byName('D')), true);
    assert.equal(m.effHidden(m.doc, byName('A')), false);
    assert.equal(m.effLocked(m.doc, byName('C')), true);
    assert.equal(m.effLocked(m.doc, byName('D')), false);
  });

  await t.test('export leaves out objects inside a hidden group', () => {
    const { m, sel } = setup(3);
    m.groupObjects(m.doc, sel('AB')).group.hidden = true;
    const svg = m.buildSVG(m.doc.objects, { x: 0, y: 0, w: 800, h: 600 }, 800, 600, null);
    assert.equal((svg.match(/<rect /g) || []).length, 1);
  });
});

test('groups: stacking order', async (t) => {
  await t.test('bring to front moves a whole group, keeping it in one piece', () => {
    const { m, sel, order } = setup();
    m.groupObjects(m.doc, sel('BC'));
    m.reorderUnits(m.doc, sel('BC'), 'front');
    assert.equal(order(), 'ADEFBC');
  });

  await t.test('forward and backward step a group past one neighbour at a time', () => {
    const { m, sel, order } = setup();
    m.groupObjects(m.doc, sel('BC'));
    m.reorderUnits(m.doc, sel('BC'), 'forward');
    assert.equal(order(), 'ADBCEF');
    m.reorderUnits(m.doc, sel('BC'), 'backward');
    m.reorderUnits(m.doc, sel('BC'), 'backward');
    assert.equal(order(), 'BCADEF');
  });

  await t.test('reordering one member stays inside its group', () => {
    const { m, sel, order } = setup();
    m.groupObjects(m.doc, sel('BCD'));
    m.reorderUnits(m.doc, sel('B'), 'front');
    assert.equal(order(), 'ACDBEF');
    m.reorderUnits(m.doc, sel('B'), 'back');
    assert.equal(order(), 'ABCDEF');
  });

  await t.test('send to back with loose objects behaves as before', () => {
    const { m, sel, order } = setup();
    m.reorderUnits(m.doc, sel('CE'), 'back');
    assert.equal(order(), 'CEABDF');
  });
});

test('groups: copying', async (t) => {
  await t.test('copying a whole group copies the group, with new ids', () => {
    const { m, sel } = setup(3);
    const g = m.groupObjects(m.doc, sel('AB')).group;
    const objs = m.doc.objects.filter((o) => o.name !== 'C');
    const c = m.copyWithGroups(m.doc, objs, m.groupsFilledBy(m.doc, objs), true);
    assert.equal(c.groups.length, 1);
    assert.notEqual(c.groups[0].id, g.id);
    assert.ok(c.objects.every((o) => o.parent === c.groups[0].id));
    assert.ok(c.objects.every((o) => !objs.some((x) => x.id === o.id)));
  });

  await t.test('duplicating part of a group keeps the copy in that group; pasting it elsewhere does not', () => {
    const { m, sel, byName } = setup(3);
    const g = m.groupObjects(m.doc, sel('AB')).group;
    const part = [byName('A')];
    assert.deepEqual(plain(m.groupsFilledBy(m.doc, part)), []);
    assert.equal(m.copyWithGroups(m.doc, part, [], true).objects[0].parent, g.id);
    assert.equal(m.copyWithGroups(m.doc, part, [], false).objects[0].parent, undefined);
  });
});

test('groups: scaling and turning several objects together', async (t) => {
  await t.test('scaleAbout grows positions, sizes and outlines from the anchor', () => {
    const m = loadCutoutModules();
    const o = m.newShape('rect', { x: 100, y: 100, w: 50, h: 20, sw: 2, r: 4 });
    const o0 = plain(o);
    m.scaleAbout(o, o0, 100, 100, 2);
    assert.deepEqual([o.x, o.y, o.w, o.h, o.sw, o.r], [100, 100, 100, 40, 4, 8]);
    const line = m.newShape('line', { x1: 0, y1: 0, x2: 10, y2: 0 });
    m.scaleAbout(line, plain(line), 0, 0, 3);
    assert.equal(line.x2, 30);
  });

  await t.test('scaleAbout scales text by its size', () => {
    const m = loadCutoutModules();
    const t0 = m.newShape('text', { x: 0, y: 0, size: 20 });
    m.scaleAbout(t0, plain(t0), 0, 0, 1.5);
    assert.equal(t0.size, 30);
  });

  await t.test('rotateAbout turns objects around a shared center', () => {
    const m = loadCutoutModules();
    const o = m.newShape('rect', { x: 90, y: -10, w: 20, h: 20, rot: 10 });   // centered at (100, 0)
    m.rotateAbout(o, plain(o), 0, 0, 90);
    assert.ok(Math.abs(o.x + 10) < 1e-9 && Math.abs(o.y - 90) < 1e-9, o.x + ',' + o.y);   // now centered at (0, 100)
    assert.equal(o.rot, 100);
    const line = m.newShape('line', { x1: 10, y1: 0, x2: 20, y2: 0 });
    m.rotateAbout(line, plain(line), 0, 0, 90);
    assert.ok(Math.abs(line.x1) < 1e-9 && Math.abs(line.y1 - 10) < 1e-9);
  });
});

test('groups: other commands', async (t) => {
  await t.test('combining shapes inside a group keeps the result in that group', () => {
    const { m, sel, byName } = setup(4);
    const g = m.groupObjects(m.doc, sel('BC')).group;
    byName('C').x = byName('B').x + 20;   // make them overlap
    m.S.sel = sel('BC');
    m.runBoolean('unite');
    m.normalizeGroups(m.doc);
    const res = m.doc.objects.find((o) => o.name === 'United shape');
    assert.equal(res.parent, g.id);
    assert.equal(m.doc.groups.length, 1);
  });

  await t.test('combining a whole group with something outside it leaves the group empty, so it goes away', () => {
    const { m, sel, byName } = setup(3);
    m.groupObjects(m.doc, sel('BC'));
    byName('B').x = 0; byName('C').x = 20;
    m.S.sel = sel('ABC');
    m.runBoolean('unite');
    m.normalizeGroups(m.doc);
    assert.equal(m.doc.groups.length, 0);
    assert.equal(m.doc.objects.length, 1);
  });

  await t.test('a drawing from before groups existed opens with no groups', () => {
    const m = loadCutoutModules();
    const d = { objects: [m.newShape('rect', {})], nextId: 5 };
    m.normalizeGroups(d);
    assert.deepEqual(plain(d.groups), []);
    assert.equal(d.objects.length, 1);
  });
});
