'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

/*
 * A monospace stand-in for an opentype font (every character is half the font size wide) whose getPath draws a
 * real outline: one rectangle per letter, 0.4 of the size wide and 0.7 tall, standing on the baseline. A space has
 * no outline. At size 100 with the default line height 1.2, the baseline of line 0 is at 90 and letter k's
 * rectangle is x 50k .. 50k + 40, y 20 .. 90.
 */
function fakeFont() {
  const step = (size, opts) => size * 0.5 + ((opts && opts.letterSpacing) || 0) * size;
  const forEachGlyph = (text, x, y, size, opts, cb) => {
    for (let i = 0; i < text.length; i++) { cb({ index: i }, x, y, size); x += step(size, opts); }
    return x;
  };
  return {
    unitsPerEm: 1000, ascender: 800, descender: -200,
    getAdvanceWidth: (text, size, opts) => forEachGlyph(text, 0, 0, size, opts, () => {}),
    forEachGlyph,
    getPath: (text, x, y, size, opts) => ({
      toPathData: () => {
        let d = '';
        for (let i = 0; i < text.length; i++) {
          if (/[\s\u200B]/.test(text[i])) continue;   // (a space and a zero-width space have no outline)
          const x0 = x + i * step(size, opts), x1 = x0 + size * 0.4, y0 = y - size * 0.7;
          d += 'M' + x0 + ' ' + y0 + 'L' + x1 + ' ' + y0 + 'L' + x1 + ' ' + y + 'L' + x0 + ' ' + y + 'Z';
        }
        return d;
      }
    }),
  };
}
function setup(props) {
  const m = loadAppModules({ recordToasts: true });
  m._sandbox.fontOf = () => fakeFont();
  const o = m.newShape('text', Object.assign({ x: 10, y: 20, size: 100, font: 'fake', text: 'AB C' }, props));
  m.doc.objects.push(o);
  m.S.sel = new Set([o.id]);
  return { m, o };
}
// Arrays made inside the vm have its own Array, which deepEqual treats as a different kind of thing
const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, (msg || '') + ' ' + a + ' vs ' + b);
// (gradient positions are kept to 5 decimals of a fraction of the letter's box: far finer than a pixel)
const nearPx = (a, b, msg) => near(a, b, msg, 1e-3);

test('break apart: which pieces of a text get a shape', async (t) => {
  const { m } = setup();
  await t.test('spaces and line breaks get none; the rest are in reading order', () => {
    assert.deepEqual(plain(m.breakClusters('ab c\nd').map(c => c.i)), [0, 1, 3, 5]);
  });
  await t.test('a letter keeps its accent (a combining mark)', () => {
    const c = m.breakClusters('éx');
    assert.equal(c.length, 2);
    assert.equal(c[0].n, 2);
  });
  await t.test('a character outside the basic plane is one piece two units long', () => {
    const c = m.breakClusters('\u{1D538}b');
    assert.deepEqual(plain(c), [{ i: 0, n: 2 }, { i: 2, n: 1 }]);
  });
});

test('break apart: the letters', async (t) => {
  await t.test('one plain shape per letter, each exactly where its letter was drawn', () => {
    const { m, o } = setup();
    const r = m.breakApartText(o);
    assert.equal(r.shapes.length, 3);
    assert.deepEqual(plain(r.shapes.map(s => s.name)), ['A', 'B', 'C']);
    assert.ok(r.shapes.every(s => s.kind === 'path' && s.rot === 0));
    // A: ink box x 0..40, y 20..90 in the text's box; the text sits at (10, 20)
    near(r.shapes[0].x, 10); near(r.shapes[0].y, 40); near(r.shapes[0].w, 40); near(r.shapes[0].h, 70);
    near(r.shapes[1].x, 60);          // B is one step (50) further on
    near(r.shapes[2].x, 160);         // C is after the space: three steps
    assert.equal(r.shapes[0].nat.w, r.shapes[0].w);
  });
  await t.test('letter spacing and a second line are followed', () => {
    const { m, o } = setup({ text: 'AB\nC', ls: 0.1 });
    const r = m.breakApartText(o);
    near(r.shapes[1].x - r.shapes[0].x, 60);   // 50 + 10% of the size (100)
    near(r.shapes[2].y - r.shapes[0].y, 120);  // one line (1.2 x 100) down
  });
  await t.test('every letter takes the text\'s look', () => {
    const { m, o } = setup({ fill: '#123456', stroke: '#abcdef', sw: 3, opacity: 0.5, blend: 'multiply', hidden: true });
    m.breakApartText(o).shapes.forEach(s => {
      assert.equal(s.fill, '#123456'); assert.equal(s.stroke, '#abcdef'); assert.equal(s.sw, 3);
      assert.equal(s.opacity, 0.5); assert.equal(s.blend, 'multiply'); assert.equal(s.hidden, true);
    });
  });
  await t.test('a letter with a color of its own keeps that color, over a gradient too', () => {
    const { m, o } = setup({ text: 'ABC', grad: null });
    o.grad = m.makeGrad('linear', '#ff0000', '#0000ff'); o.fill = '#ff0000';
    o.runs = [{ n: 1, c: '#00ff00' }, { n: 2 }];
    m.refresh(o);
    const [a, b] = m.breakApartText(o).shapes;
    assert.equal(a.fill, '#00ff00'); assert.equal(a.grad, undefined);
    assert.ok(b.grad && b.grad.type === 'linear');
  });
  await t.test('a letter in a font with no outline for it is left out', () => {
    const { m, o } = setup({ text: 'A​B' });   // a zero-width space: not whitespace to \s, but nothing to draw
    const r = m.breakApartText(o);
    assert.deepEqual(plain(r.shapes.map(s => s.name)), ['A', 'B']);
  });
});

test('break apart: turned and mirrored text', async (t) => {
  const cases = [{ rot: 30 }, { rot: -75, fy: true }, { rot: 140, fx: true }, { rot: 0, fx: true, fy: true }, { rot: 200, fx: true, fy: true }];
  for (const c of cases) await t.test('each letter lands on its letter, ' + JSON.stringify(c), () => {
    const { m, o } = setup(c);
    const letters = m.worldPaper(o).children;   // the text's own outline on the page, one piece per letter
    const r = m.breakApartText(o);
    assert.equal(letters.length, r.shapes.length);
    r.shapes.forEach((s, k) => {
      const a = letters[k].bounds, b = m.worldPaper(s).bounds;
      near(a.x, b.x, 'x'); near(a.y, b.y, 'y'); near(a.width, b.width, 'w'); near(a.height, b.height, 'h');
      assert.equal(!!s.fx, !!o.fx); assert.equal(!!s.fy, !!o.fy); assert.equal(s.rot, o.rot);
    });
  });
});

test('break apart: gradients and photos go along', async (t) => {
  await t.test('a linear gradient keeps its colors where they were on the page', () => {
    const { m, o } = setup({ text: 'ABC', rot: 25 });
    o.grad = m.makeGrad('linear', '#ff0000', '#0000ff'); m.refresh(o);
    const W = o.w, H = o.h, g = o.grad;
    m.breakApartText(o).shapes.forEach((s, k) => {
      const gx = 50 * k, gy = 20, gw = s.w, gh = s.h;   // the letter's ink box in the text's box
      // the gradient line's ends, in the text's box coordinates, before and after
      nearPx(s.grad.x1 * gw + gx, g.x1 * W, 'x1'); nearPx(s.grad.x2 * gw + gx, g.x2 * W, 'x2');
      nearPx(s.grad.y1 * gh + gy, g.y1 * H, 'y1'); nearPx(s.grad.y2 * gh + gy, g.y2 * H, 'y2');
      assert.equal(s.fill, g.stops[0].c);
    });
  });
  await t.test('a radial gradient keeps its center and its area', () => {
    const { m, o } = setup({ text: 'ABC' });
    o.grad = m.makeGrad('radial', '#ff0000', '#0000ff'); o.grad.cx = 0.8; o.grad.cy = 0.3; o.grad.r = 0.4; m.refresh(o);
    m.breakApartText(o).shapes.forEach((s, k) => {
      nearPx(s.grad.cx * s.w + 50 * k, 0.8 * o.w, 'cx'); nearPx(s.grad.cy * s.h + 20, 0.3 * o.h, 'cy');
      near(s.grad.r * s.grad.r * s.w * s.h, 0.4 * 0.4 * o.w * o.h, 'area', 0.5);
    });
  });
  await t.test('a gradient is never pushed past what a saved drawing may hold', () => {
    const g = loadAppModules().makeGrad('linear', '#ff0000', '#0000ff');
    const c = loadAppModules().glyphGrad(g, 60000, 100, 0, 0, 0.01, 100);
    assert.ok(Math.abs(c.x2) <= 1000);
  });
  await t.test('a photo fill stays where it was on the page, turned and mirrored too', () => {
    [{ rot: 0 }, { rot: 40 }, { rot: 40, fx: true }, { rot: -110, fx: true, fy: true }].forEach(c => {
      const { m, o } = setup(c);
      o.pic = { id: 'p1', dx: 17, dy: -9, s: 0.5 };
      // the photo's middle on the page, as releaseMask works it out
      const mid = ob => {
        const r = m.rotPt(ob.fx ? -ob.pic.dx : ob.pic.dx, ob.fy ? -ob.pic.dy : ob.pic.dy, 0, 0, ob.rot), ctr = m.centerOf(ob);
        return { x: ctr.x + r.x, y: ctr.y + r.y };
      };
      const want = mid(o), r = m.breakApartText(o);
      r.shapes.forEach(s => {
        const got = mid(s);
        assert.ok(Math.abs(got.x - want.x) < 0.01 && Math.abs(got.y - want.y) < 0.01, JSON.stringify(c) + ' ' + JSON.stringify([got, want]));
        assert.equal(s.pic.id, 'p1'); assert.equal(s.pic.s, 0.5);
      });
    });
  });
});

test('break apart: the limit', async (t) => {
  await t.test('exactly the limit is fine, and spaces do not count', () => {
    const { m, o } = setup({ text: 'ab '.repeat(50).trim() + 'a'.repeat(0) });
    // 50 x "ab" = 100 letters with 49 spaces between
    assert.equal(m.breakClusters(o.text).length, 100);
    assert.equal(m.breakApartText(o).shapes.length, 100);
  });
  await t.test('one over is refused, saying how many there are', () => {
    const { m, o } = setup({ text: 'a'.repeat(m_max() + 1) });
    const r = m.breakApartText(o);
    assert.ok(r.why && r.why.includes('101') && r.why.includes('100'));
    assert.equal(r.shapes, undefined);
  });
  function m_max() { return loadAppModules().BREAK_APART_MAX; }
});

test('break apart: the command', async (t) => {
  await t.test('the text is replaced by its letters, in a folder named after it, and they are selected', () => {
    const { m, o } = setup();
    const before = m.newShape('rect', { x: 0, y: 0, w: 5, h: 5 }), after = m.newShape('rect', { x: 0, y: 0, w: 5, h: 5 });
    m.doc.objects.unshift(before); m.doc.objects.push(after);
    m.breakApartSelected();
    const names = m.doc.objects.map(x => x.name || x.kind);
    assert.deepEqual(plain(names), ['rect', 'A', 'B', 'C', 'rect']);   // same place in the stacking order
    assert.ok(!m.byId(o.id));
    assert.equal(m.doc.groups.length, 1);
    const g = m.doc.groups[0];
    assert.equal(g.name, 'AB C');
    assert.ok(m.doc.objects.filter(x => x.kind === 'path').every(x => x.parent === g.id));
    assert.equal(m.S.sel.size, 3);
    assert.equal(m._commits.length, 1);
  });
  await t.test('inside a folder already, the new folder is in it too', () => {
    const { m, o } = setup();
    const other = m.newShape('rect', { x: 0, y: 0, w: 5, h: 5 });
    m.doc.objects.push(other);
    const outer = m.groupObjects(m.doc, new Set([o.id, other.id])).group;
    m.S.sel = new Set([o.id]);
    m.breakApartSelected();
    const inner = m.doc.groups.find(g => g.id !== outer.id);
    assert.equal(inner.parent, outer.id);
    assert.ok(m.doc.objects.filter(x => x.kind === 'path').every(x => x.parent === inner.id));
  });
  await t.test('a single letter becomes one plain shape, with no folder', () => {
    const { m } = setup({ text: ' A ' });
    m.breakApartSelected();
    assert.equal(m.doc.groups.length, 0);
    assert.equal(m.doc.objects.length, 1);
    assert.equal(m.doc.objects[0].name, 'A');
    assert.equal(m.doc.objects[0].parent, undefined);
  });
  await t.test('too long, empty, locked, or not a text: nothing changes, and it says why', () => {
    const long = setup({ text: 'a'.repeat(101) });
    long.m.breakApartSelected();
    assert.equal(long.m.doc.objects.length, 1);
    assert.match(long.m._toasts[0], /up to 100 letters/);
    assert.equal(long.m._commits.length, 0);

    const empty = setup({ text: '  \n ' });
    empty.m.breakApartSelected();
    assert.equal(empty.m.doc.objects.length, 1);
    assert.equal(empty.m._toasts.length, 1);

    const locked = setup({ locked: true });
    locked.m.breakApartSelected();
    assert.equal(locked.m.doc.objects.length, 1);
    assert.match(locked.m._toasts[0], /locked/);

    const rect = loadAppModules({ recordToasts: true });
    const r = rect.newShape('rect', { x: 0, y: 0, w: 5, h: 5 });
    rect.doc.objects.push(r); rect.S.sel = new Set([r.id]);
    rect.breakApartSelected();
    assert.equal(rect.doc.objects.length, 1);
    assert.match(rect._toasts[0], /Select a text/);
  });
  await t.test('the saved drawing holds only plain shapes, so it opens again as it was', () => {
    const { m } = setup({ rot: 20, fx: true });
    m.breakApartSelected();
    const back = m.sanitizeDoc(JSON.parse(m.docJSON(m.doc)));
    assert.equal(back.objects.length, 3);
    assert.ok(back.objects.every(x => x.kind === 'path'));
    back.objects.forEach((x, k) => { near(x.w, m.doc.objects[k].w); near(x.x, m.doc.objects[k].x); });
  });
});
