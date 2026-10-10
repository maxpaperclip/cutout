'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

// Arrays made inside the vm have its own Array, which deepEqual treats as a different kind of thing
const plain = x => JSON.parse(JSON.stringify(x));

/*
 * A monospace stand-in for an opentype font: every character is half the font size wide (plus letter
 * spacing), the ascender is 0.8 of the size and the descender 0.2. At size 100 with the default line
 * height of 1.2: a line slot is 120 tall, the baseline of line i is at 90 + 120 * i, a character is 50 wide.
 * `log` records what getPath was asked to draw; `counter.walks` counts forEachGlyph calls.
 */
function fakeFont({ log, counter, ligature } = {}) {
  const forEachGlyph = (text, x, y, size, opts, cb) => {
    if (counter) counter.walks++;
    const step = size * 0.5 + ((opts && opts.letterSpacing) || 0) * size;
    for (let i = 0; i < text.length; i++) {
      cb({ index: i }, x, y, size);
      x += step;
      if (ligature && text.slice(i, i + 2) === 'fi') i++;   // "fi" is one glyph covering two characters
    }
    return x;
  };
  return {
    unitsPerEm: 1000, ascender: 800, descender: -200,
    getAdvanceWidth: (text, size, opts) => forEachGlyph(text, 0, 0, size, opts, () => {}),
    forEachGlyph,
    getPath: (text, x, y, size, opts) => { if (log) log.push({ text, x, y, size, ls: opts.letterSpacing }); return { toPathData: () => 'P' + text + ';' }; },
  };
}
function setup(font, props) {
  const m = loadAppModules();
  m._sandbox.fontOf = () => font || fakeFont();
  const o = m.newShape('text', Object.assign({ x: 0, y: 0, size: 100, font: 'fake' }, props));
  return { m, o, lay: () => m.textLayout(o) };
}

test('text layout: where lines go (the same numbers the outlines are drawn with)', async (t) => {
  await t.test('left aligned lines start at 0, and sit on their own baselines', () => {
    const log = [];
    const { m, o } = setup(fakeFont({ log }), { text: 'ab\nabcd' });
    assert.deepEqual(log.map(c => [c.text, c.x, c.y]), [['ab', 0, 90], ['abcd', 0, 210]]);
    assert.equal(o.w, 200);
    assert.equal(o.h, 240);
    assert.equal(o.d, 'Pab;Pabcd;');
    assert.ok(m);
  });

  await t.test('centered and right aligned lines are shifted by the width left over', () => {
    const c = [], r = [];
    setup(fakeFont({ log: c }), { text: 'ab\nabcd', align: 'center' });
    setup(fakeFont({ log: r }), { text: 'ab\nabcd', align: 'right' });
    assert.deepEqual(c.map(l => l.x), [50, 0]);
    assert.deepEqual(r.map(l => l.x), [100, 0]);
  });

  await t.test('an empty line draws nothing but still takes its slot', () => {
    const log = [];
    const { o } = setup(fakeFont({ log }), { text: 'a\n\nb' });
    assert.deepEqual(log.map(c => [c.text, c.y]), [['a', 90], ['b', 330]]);
    assert.equal(o.h, 360);
  });

  await t.test('a text is never narrower than 0.4 of its size, so there is always a box to click and type in', () => {
    const { o } = setup(fakeFont(), { text: '' });
    assert.equal(o.w, 40);
    assert.equal(o.h, 120);
  });

  await t.test('letter spacing widens every character, including the last', () => {
    const { lay } = setup(fakeFont(), { text: 'abc', ls: 0.1 });
    assert.deepEqual(plain(lay().lines[0].m.xs), [0, 60, 120, 180]);
    assert.equal(lay().lines[0].m.width, 180);
  });

  await t.test('line indexes count the line break as a character', () => {
    const { lay } = setup(fakeFont(), { text: 'ab\ncde\n' });
    assert.deepEqual(plain(lay().lines.map(L => [L.start, L.end])), [[0, 2], [3, 6], [7, 7]]);
  });
});

test('text layout: caret and selection', async (t) => {
  await t.test('the caret sits between letters, from the top of the font to its bottom', () => {
    const { m, lay } = setup(fakeFont(), { text: 'abc' });
    const c = m.caretAt(lay(), 2);
    assert.deepEqual([c.x, c.y0, c.y1, c.line], [100, 10, 110, 0]);
  });

  await t.test('the end of a line is on that line; the next index is the start of the next one', () => {
    const { m, lay } = setup(fakeFont(), { text: 'ab\ncd' });
    assert.deepEqual([m.caretAt(lay(), 2).x, m.caretAt(lay(), 2).line], [100, 0]);
    assert.deepEqual([m.caretAt(lay(), 3).x, m.caretAt(lay(), 3).line], [0, 1]);
    assert.equal(m.caretAt(lay(), 3).y0, 130);
  });

  await t.test('a caret follows the alignment', () => {
    const { m, lay } = setup(fakeFont(), { text: 'ab\nabcd', align: 'center' });
    assert.equal(m.caretAt(lay(), 0).x, 50);
    assert.equal(m.caretAt(lay(), 2).x, 150);
  });

  await t.test('an index past the end is held at the end', () => {
    const { m, lay } = setup(fakeFont(), { text: 'abc' });
    assert.equal(m.caretAt(lay(), 99).x, 150);
    assert.equal(m.caretAt(lay(), -4).x, 0);
  });

  await t.test('a selection on one line is one rectangle, whichever way round it was made', () => {
    const { m, lay } = setup(fakeFont(), { text: 'abcd' });
    assert.deepEqual(JSON.parse(JSON.stringify(m.selectionRects(lay(), 1, 3))), [{ x: 50, y: 10, w: 100, h: 100 }]);
    assert.deepEqual(JSON.parse(JSON.stringify(m.selectionRects(lay(), 3, 1))), [{ x: 50, y: 10, w: 100, h: 100 }]);
    assert.deepEqual(plain(m.selectionRects(lay(), 2, 2)), []);
  });

  await t.test('a selection over several lines is a rectangle per line, and shows the line break it covers', () => {
    const { m, lay } = setup(fakeFont(), { text: 'ab\ncd' });
    const r = JSON.parse(JSON.stringify(m.selectionRects(lay(), 1, 4)));
    assert.equal(r.length, 2);
    assert.deepEqual([r[0].x, r[0].w], [50, 75]);   // from b to the end of the line, plus the break
    assert.deepEqual([r[1].x, r[1].w, r[1].y], [0, 50, 130]);
  });

  await t.test('an empty line inside a selection still shows', () => {
    const { m, lay } = setup(fakeFont(), { text: 'a\n\nb' });
    const r = JSON.parse(JSON.stringify(m.selectionRects(lay(), 0, 4)));
    assert.equal(r.length, 3);
    assert.ok(r[1].w > 0);
    assert.equal(r[1].y, 130);
  });

  await t.test('the last line break is not shown when the selection ends on that line', () => {
    const { m, lay } = setup(fakeFont(), { text: 'ab\ncd' });
    const r = JSON.parse(JSON.stringify(m.selectionRects(lay(), 3, 5)));
    assert.deepEqual(r.map(x => x.w), [100]);
  });
});

test('text layout: clicks and movement', async (t) => {
  await t.test('a click lands in the nearest gap between letters', () => {
    const { m, lay } = setup(fakeFont(), { text: 'abc' });
    assert.equal(m.indexAtPoint(lay(), 24, 50), 0);
    assert.equal(m.indexAtPoint(lay(), 26, 50), 1);
    assert.equal(m.indexAtPoint(lay(), 74, 50), 1);
    assert.equal(m.indexAtPoint(lay(), 76, 50), 2);
  });

  await t.test('before the text goes to the start, and past it to the end', () => {
    const { m, lay } = setup(fakeFont(), { text: 'abc' });
    assert.equal(m.indexAtPoint(lay(), -30, 50), 0);
    assert.equal(m.indexAtPoint(lay(), 900, 50), 3);
  });

  await t.test('the line is picked by height, and above or below the text is the first or last line', () => {
    const { m, lay } = setup(fakeFont(), { text: 'ab\ncd\nef' });
    assert.equal(m.indexAtPoint(lay(), 10, 130), 3);
    assert.equal(m.indexAtPoint(lay(), 1000, 130), 5);
    assert.equal(m.indexAtPoint(lay(), 0, -500), 0);
    assert.equal(m.indexAtPoint(lay(), 1000, 5000), 8);
  });

  await t.test('a click on a centered line is measured from where that line starts', () => {
    const { m, lay } = setup(fakeFont(), { text: 'ab\nabcd', align: 'center' });
    assert.equal(m.indexAtPoint(lay(), 60, 50), 0);   // the first line starts at x = 50
    assert.equal(m.indexAtPoint(lay(), 80, 50), 1);
    assert.equal(m.indexAtPoint(lay(), 20, 200), 3);  // the second line is the wider one, so it starts at 0: 20 is nearest its first gap
    assert.equal(m.indexAtPoint(lay(), 30, 200), 4);  // and 30 is nearest the next
  });

  await t.test('a click never lands between the two halves of one character', () => {
    const { m, lay } = setup(fakeFont(), { text: 'a\u{1F600}b' });   // the emoji is two UTF-16 units
    const xs = lay().lines[0].m.xs;
    const mid = xs[2] - 1;   // closest to the gap between the halves
    const i = m.indexAtPoint(lay(), mid, 50);
    assert.notEqual(i, 2);
  });

  await t.test('Up and Down keep to the column the caret started from, even across a short line', () => {
    const { m, lay } = setup(fakeFont(), { text: 'abcd\nab\nabcd' });
    const a = m.verticalMove(lay(), 4, +1, null);     // end of line 1, down onto the short line
    assert.equal(a.index, 7);                         // its end
    const b = m.verticalMove(lay(), a.index, +1, a.goalX);
    assert.equal(b.index, 12);                        // back out to the same column
    assert.equal(m.verticalMove(lay(), b.index, -1, b.goalX).index, 7);
  });

  await t.test('Up from the first line goes to the start, Down from the last to the end', () => {
    const { m, lay } = setup(fakeFont(), { text: 'abc\ndef' });
    assert.equal(m.verticalMove(lay(), 2, -1, null).index, 0);
    assert.equal(m.verticalMove(lay(), 5, +1, null).index, 7);
  });
});

test('text layout: ligatures', async (t) => {
  await t.test('characters inside a ligature are measured from the characters before them, and never go backwards', () => {
    const m = loadAppModules();
    const mx = m.lineMetrics(fakeFont({ ligature: true }), 'lig', 100, 0, 'fix');
    assert.deepEqual(JSON.parse(JSON.stringify(mx.xs)), [0, 50, 50, 100]);
    assert.equal(mx.width, 100);
  });

  await t.test('without ligatures every character has its own position', () => {
    const m = loadAppModules();
    const mx = m.lineMetrics(fakeFont(), 'plain', 100, 0, 'fix');
    assert.deepEqual(JSON.parse(JSON.stringify(mx.xs)), [0, 50, 100, 150]);
  });

  await t.test('a font with no per-glyph walk still gets even positions from its width', () => {
    const m = loadAppModules();
    const mx = m.lineMetrics({ getAdvanceWidth: () => 90 }, 'old', 100, 0, 'abc');
    assert.deepEqual(JSON.parse(JSON.stringify(mx.xs)), [0, 30, 60, 90]);
  });
});

test('text layout: measurements are kept, and dropped when a font arrives', async (t) => {
  await t.test('an unchanged line is not measured again', () => {
    const counter = { walks: 0 };
    const { m, o } = setup(fakeFont({ counter }), { text: 'one\ntwo' });
    const first = counter.walks;
    m.textLayout(o); m.textLayout(o);
    assert.equal(counter.walks, first);
    o.text = 'one\ntwo!';   // only the second line changed
    m.textLayout(o);
    assert.equal(counter.walks, first + 1);
  });

  await t.test('purgeLineMetrics makes the lines of that font be measured again', () => {
    const counter = { walks: 0 };
    const { m, o } = setup(fakeFont({ counter }), { text: 'one' });
    const first = counter.walks;
    m.purgeLineMetrics('fake');
    m.textLayout(o);
    assert.equal(counter.walks, first + 1);
    m.purgeLineMetrics('some-other-font');
    m.textLayout(o);
    assert.equal(counter.walks, first + 1);
  });
});

test('text layout: words and lines for double and triple click', async (t) => {
  await t.test('a double-click picks the word under it', () => {
    const m = loadAppModules();
    assert.deepEqual(Array.from(m.wordRange('hello world', 2)), [0, 5]);
    assert.deepEqual(Array.from(m.wordRange('hello world', 8)), [6, 11]);
  });

  await t.test('spaces and punctuation are picked as runs of their own', () => {
    const m = loadAppModules();
    assert.deepEqual(Array.from(m.wordRange('hello   world', 6)), [5, 8]);
    assert.deepEqual(Array.from(m.wordRange('a, b', 1)), [1, 2]);
    assert.deepEqual(Array.from(m.wordRange('wait... what', 5)), [4, 7]);
  });

  await t.test('at the end of the text, or of a line, it picks the word before', () => {
    const m = loadAppModules();
    assert.deepEqual(Array.from(m.wordRange('hello world', 11)), [6, 11]);
    assert.deepEqual(Array.from(m.wordRange('ab\ncd', 2)), [0, 2]);
  });

  await t.test('it stays on its line, and an empty line is just a caret', () => {
    const m = loadAppModules();
    assert.deepEqual(Array.from(m.wordRange('ab\ncd', 3)), [3, 5]);
    assert.deepEqual(Array.from(m.wordRange('a\n\nb', 2)), [2, 2]);
    assert.deepEqual(Array.from(m.wordRange('', 0)), [0, 0]);
  });

  await t.test('letters with accents, digits and underscores belong to the word', () => {
    const m = loadAppModules();
    assert.deepEqual(Array.from(m.wordRange('café_12 x', 2)), [0, 7]);
  });

  await t.test('a triple-click picks the whole line', () => {
    const m = loadAppModules();
    assert.deepEqual(Array.from(m.lineRange('ab\ncd\nef', 4)), [3, 5]);
    assert.deepEqual(Array.from(m.lineRange('ab\ncd\nef', 0)), [0, 2]);
    assert.deepEqual(Array.from(m.lineRange('ab\ncd\nef', 2)), [0, 2]);
    assert.deepEqual(Array.from(m.lineRange('ab\ncd\nef', 3)), [3, 5]);
    assert.deepEqual(Array.from(m.lineRange('ab\ncd\nef', 8)), [6, 8]);
  });
});

test('picking text by its box', async (t) => {
  await t.test('boxContains: inside, outside, and padded', () => {
    const m = loadAppModules();
    const o = { x: 10, y: 10, w: 100, h: 20, rot: 0 };
    assert.equal(m.boxContains(o, { x: 50, y: 20 }), true);
    assert.equal(m.boxContains(o, { x: 5, y: 20 }), false);
    assert.equal(m.boxContains(o, { x: 5, y: 20 }, 8), true);
    assert.equal(m.boxContains(o, { x: 50, y: 31 }), false);
  });

  await t.test('boxContains follows a turned box, and a mirrored one', () => {
    const m = loadAppModules();
    const o = { x: 0, y: 0, w: 100, h: 20, rot: 90 };   // turned about (50, 10): now 20 wide and 100 tall
    assert.equal(m.boxContains(o, { x: 50, y: -30 }), true);
    assert.equal(m.boxContains(o, { x: 80, y: 10 }), false);
    assert.equal(m.boxContains(Object.assign({ fx: true }, o), { x: 50, y: -30 }), true);
    assert.equal(m.boxContains(Object.assign({ fy: true }, o), { x: 80, y: 10 }), false);
  });

  // A big rectangle, a selected text on top of it, and a small rectangle on top of that
  function scene() {
    const { m, o: text } = setup(fakeFont(), { text: 'ab', x: 100, y: 100 });   // box 100 x 120
    const under = m.newShape('rect', { x: 0, y: 0, w: 500, h: 500 });
    const above = m.newShape('rect', { x: 100, y: 100, w: 30, h: 30 });
    m.doc.objects.length = 0;
    m.doc.objects.push(under, text, above);
    m.S.sel = new Set([text.id]);
    return { m, text, under, above };
  }

  await t.test('the space around the letters of a selected text picks the text, even over a shape beneath it', () => {
    const { m, text, under } = scene();
    assert.equal(m.textBoxAt({ x: 190, y: 200 }, under), text);   // inside its box, but not on any letter
    assert.equal(m.textBoxAt({ x: 190, y: 200 }, null), text);
  });

  await t.test('it does not reach outside its box', () => {
    const { m, under } = scene();
    assert.equal(m.textBoxAt({ x: 300, y: 300 }, under), null);
  });

  await t.test('a shape drawn above the text keeps the click', () => {
    const { m, above } = scene();
    assert.equal(m.textBoxAt({ x: 110, y: 110 }, above), null);
  });

  await t.test('only a selected text is picked this way', () => {
    const { m, under } = scene();
    m.S.sel = new Set();
    assert.equal(m.textBoxAt({ x: 190, y: 200 }, under), null);
  });

  await t.test('a locked or hidden text is left alone', () => {
    const a = scene(); a.text.locked = true;
    assert.equal(a.m.textBoxAt({ x: 190, y: 200 }, a.under), null);
    const b = scene(); b.text.hidden = true;
    assert.equal(b.m.textBoxAt({ x: 190, y: 200 }, b.under), null);
  });

  await t.test('when the click already hit the text itself there is nothing more to pick', () => {
    const { m, text } = scene();
    assert.equal(m.textBoxAt({ x: 190, y: 200 }, text), null);
  });

  await t.test('the topmost of several selected texts wins', () => {
    const { m, text, under } = scene();
    const second = m.newShape('text', { text: 'cd', x: 100, y: 100, size: 100, font: 'fake' });
    m.doc.objects.splice(2, 0, second);
    m.S.sel = new Set([text.id, second.id]);
    assert.equal(m.textBoxAt({ x: 190, y: 200 }, under), second);
  });

  await t.test('a text that is only a space can be picked by its box', () => {
    const { m } = setup(fakeFont(), { text: ' ' });
    const t2 = m.newShape('text', { x: 20, y: 20, size: 100, font: 'fake' });
    m.doc.objects.push(t2); m.S.sel = new Set([t2.id]);
    assert.equal(t2.text, ' ');
    assert.equal(m.textBoxAt({ x: 40, y: 60 }, null), t2);
  });
});

test('picking text on its lines, not on all of its box', async (t) => {
  // a 3-line text: "ab", an empty line, "cd" (a character is 50 wide at size 100; a line slot is 120 tall)
  function three(props) {
    const { m, o } = setup(fakeFont(), Object.assign({ text: 'ab\n\ncd', x: 0, y: 0 }, props));
    const under = m.newShape('rect', { x: -1000, y: -1000, w: 3000, h: 3000 });
    m.doc.objects.length = 0; m.doc.objects.push(under, o);
    m.S.sel = new Set([o.id]);
    return { m, o, under };
  }
  await t.test('every line has one box of its own: as wide as its text, as tall as the font', () => {
    const { m, o } = three();
    const hit = plain(m.layoutText(o).hit);
    assert.equal(hit.length, 2);   // the empty line has none
    assert.deepEqual(hit.map(r => [r.x, r.w, r.h]), [[0, 100, 100], [0, 100, 100]]);
    assert.ok(hit[1].y > hit[0].y + 100);
  });
  await t.test('the empty line and the room beside a short line let a click through, even when the text is selected', () => {
    const { m, o, under } = three();
    assert.equal(m.textInkContains(o, { x: 50, y: 60 }, 0), true);      // on "ab"
    assert.equal(m.textInkContains(o, { x: 50, y: 180 }, 0), false);    // the empty middle line
    assert.equal(m.textBoxAt({ x: 50, y: 180 }, under), null);
    assert.equal(m.textInkContains(o, { x: 160, y: 60 }, 0), false);    // beside the short line
    assert.equal(m.textBoxAt({ x: 400, y: 60 }, under), null);
  });
  await t.test('a selected text has a margin around its lines; it does not reach much further', () => {
    const { m, o, under } = three();
    assert.equal(m.textBoxAt({ x: 120, y: 60 }, under), o);     // a little beside "ab"
    assert.equal(m.textBoxAt({ x: 250, y: 60 }, under), null);
  });
  await t.test('an area text that is mostly empty is only picked on its lines', () => {
    const { m, o } = three({ text: 'ab', bw: 800, align: 'left' });
    assert.equal(m.textInkContains(o, { x: 50, y: 50 }, 0), true);
    assert.equal(m.textInkContains(o, { x: 600, y: 50 }, 0), false);
  });
  await t.test('it follows alignment: a centered short line is picked where it is', () => {
    const { m, o } = three({ text: 'ab', bw: 800, align: 'center' });
    assert.equal(m.textInkContains(o, { x: 50, y: 50 }, 0), false);
    assert.equal(m.textInkContains(o, { x: 400, y: 50 }, 0), true);
  });
  await t.test('a turned text is picked on its turned lines', () => {
    const { m, o } = three({ text: 'abcd', rot: 90, x: 0, y: 0 });   // 200 wide, 120 tall, turned about (100, 60): 120 wide, 200 tall
    assert.equal(m.textInkContains(o, { x: 100, y: -30 }, 0), true);
    assert.equal(m.textInkContains(o, { x: 100, y: 60 }, 0), true);
    assert.equal(m.textInkContains(o, { x: 10, y: 60 }, 0), false);
  });
  await t.test('the hit boxes are in the layout, so they follow a change of the text', () => {
    const { m, o } = three();
    const a = m.layoutText(o).hit.length;
    o.text = 'ab\ncd\nef'; m.refresh(o);
    assert.equal(m.layoutText(o).hit.length, 3);
    assert.equal(a, 2);
  });
});
