'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppModules } = require('./harness');

const plain = x => JSON.parse(JSON.stringify(x));

/*
 * Justification, hyphenation and optical margins, on a monospace stand-in for a font (every character is 5 wide at size 10).
 * `log` records what getPath was asked to draw: { text, x }.
 */
function fakeFont(log) {
  const step = (size, opts) => size * 0.5 + ((opts && opts.letterSpacing) || 0) * size;
  const forEachGlyph = (text, x, y, size, opts, cb) => { for (let i = 0; i < text.length; i++) { cb({ index: i }, x, y, size); x += step(size, opts); } return x; };
  return {
    unitsPerEm: 1000, ascender: 800, descender: -200,
    getAdvanceWidth: (text, size, opts) => forEachGlyph(text, 0, 0, size, opts, () => {}),
    forEachGlyph,
    getPath: (text, x, y, size) => { if (log) log.push({ text, x: Math.round(x * 1000) / 1000, y }); return { toPathData: () => 'M' + x + ' ' + y + 'L' + (x + 4) + ' ' + y + 'L' + (x + 4) + ' ' + (y - 5) + 'Z' }; },
  };
}
function setup(props) {
  const m = loadAppModules(), log = [], font = fakeFont(log);
  m._sandbox.fontOf = () => font;
  m._sandbox.fonts = { fake: {} };
  const o = m.newShape('text', Object.assign({ x: 0, y: 0, size: 10, lh: 1, font: 'fake' }, props));
  return { m, o, log, lay: () => m.textLayout(o) };
}
const xsOf = t => Array.from({ length: t.length + 1 }, (_, i) => i * 5);
const texts = lay => plain(lay.lines.map(l => l.text));
const joined = lay => lay.lines.map(l => l.text).join('');

test('hyphenation: breaking a word at the end of a line', async (t) => {
  await t.test('breakLinesEx cuts inside a word where it is allowed, and says a hyphen is added', () => {
    const { m } = setup({});
    const hy = new Map([[2, 5], [6, 5]]);
    assert.deepEqual(plain(m.breakLinesEx('hyphenation', xsOf('hyphenation'), 40, { hy })), [{ end: 6, hy: 5 }, { end: 11, hy: 0 }]);
    // a piece plus its hyphen that does not fit is not used: the old way, a cut where the box is full, with no hyphen
    assert.deepEqual(plain(m.breakLinesEx('hyphenation', xsOf('hyphenation'), 20, { hy })), [{ end: 2, hy: 5 }, { end: 6, hy: 0 }, { end: 10, hy: 0 }, { end: 11, hy: 0 }]);
    const tight = plain(m.breakLinesEx('hyphenation', xsOf('hyphenation'), 10, { hy }));
    assert.deepEqual(tight.map(c => c.end), [2, 4, 6, 8, 10, 11]);
    assert.ok(tight.every(c => c.hy === 0));
  });
  await t.test('without the option nothing changes', () => {
    const { m } = setup({});
    assert.deepEqual(plain(m.breakLinesEx('hyphenation', xsOf('hyphenation'), 40)).map(c => c.hy), [0, 0]);
    assert.deepEqual(plain(m.breakLines('aaa bbb ccc', xsOf('aaa bbb ccc'), 35)), [8, 11]);
  });
  await t.test('a long word is broken with a hyphen that is in the layout, not in the text', () => {
    const { o, lay } = setup({ text: 'hyphenation', bw: 40, hyph: true });
    const L = lay();
    assert.deepEqual(texts(L), ['hyphen', 'ation']);
    assert.equal(o.text, 'hyphenation');
    assert.equal(L.lines[0].hy.x, 30);
    assert.equal(L.lines[0].tw, 35);      // the hyphen counts toward the width
    assert.equal(L.lines[1].hy, null);
    assert.equal(L.lines[0].end, L.lines[1].start);   // and takes no index
    assert.equal(L.lines[0].cend, 6);
  });
  await t.test('the hyphen is drawn after the line', () => {
    const { m, o, log } = setup({ text: 'hyphenation', bw: 40, hyph: true });
    log.length = 0; m.buildText(o);
    assert.deepEqual(plain(log).map(l => l.text), ['hyphen', '-', 'ation']);
    assert.equal(log[1].x, 30);
  });
  await t.test('it is off unless asked for, and needs a box', () => {
    assert.deepEqual(texts(setup({ text: 'hyphenation', bw: 40 }).lay()), ['hyphenat', 'ion']);   // (cut where the box is full)
    assert.ok(setup({ text: 'hyphenation', bw: 40 }).lay().lines.every(l => !l.hy));
    assert.deepEqual(texts(setup({ text: 'hyphenation', hyph: true }).lay()), ['hyphenation']);
  });
  await t.test('capitals, accents and apostrophes are left alone', () => {
    for (const w of ['HYPHENATION', 'hyphénation', 'hyphenation\'s', 'hyphenation2']) {
      assert.ok(setup({ text: w, bw: 40, hyph: true }).lay().lines.every(l => !l.hy), w);
    }
  });
  await t.test('it works in the middle of a text, with spaces', () => {
    const L = setup({ text: 'an extraordinary result', bw: 60, hyph: true }).lay();
    assert.ok(L.lines.some(l => l.hy));
    assert.equal(L.lines.map(l => l.text).join(''), 'an extraordinary result');
    L.lines.forEach(l => assert.ok(l.tw <= 60 + 1e-9));
  });
});

test('justify: the spaces stretch to fill the box', async (t) => {
  await t.test('every line but the last of a paragraph is as wide as the box', () => {
    const { lay } = setup({ text: 'aaa bbb ccc ddd', bw: 40, align: 'justify' });
    const L = lay();
    assert.deepEqual(texts(L), ['aaa bbb ', 'ccc ddd']);
    assert.equal(L.lines[0].tw, 40);
    assert.deepEqual(plain(L.lines[0].slots), [3]);
    assert.equal(L.lines[0].gap, 5);
    assert.equal(L.lines[0].x, 0);
    assert.equal(L.lines[0].m.xs[4], 25);     // "bbb" starts 5 further on
    assert.equal(L.lines[0].m.xs[7], 40);
    assert.equal(L.lines[1].slots, null);     // the last line keeps its spaces
    assert.equal(L.lines[1].tw, 35);
  });
  await t.test('the last line before a line break is not stretched either', () => {
    const L = setup({ text: 'aaa bbb ccc\nddd eee', bw: 40, align: 'justify' }).lay();
    assert.deepEqual(plain(L.lines.map(l => l.slots)), [[3], null, null]);
  });
  await t.test('several spaces share the extra, and spaces at the start and end of a line do not', () => {
    const L = setup({ text: '  aa  bb cc dd', bw: 45, align: 'justify' }).lay();
    const l0 = L.lines[0];
    assert.ok(l0.slots && l0.slots.every(c => c >= 3), 'leading spaces are not stretched');
    assert.ok(Math.abs(l0.tw - 45) < 1e-9);
  });
  await t.test('a line of one word is left alone', () => {
    const L = setup({ text: 'aaaaaaaa bbbbbbbb', bw: 50, align: 'justify' }).lay();
    assert.equal(L.lines[0].slots, null);
  });
  await t.test('a text with no box justifies nothing (it is as wide as it is)', () => {
    const L = setup({ text: 'aaa bbb\nc d', align: 'justify' }).lay();
    assert.deepEqual(plain(L.lines.map(l => l.x)), [0, 0]);
    assert.ok(L.lines.every(l => !l.slots));
  });
  await t.test('the caret and a click agree with the stretched line', () => {
    const { m, lay } = setup({ text: 'aaa bbb ccc ddd', bw: 40, align: 'justify' });
    const L = lay();
    assert.equal(m.caretAt(L, 4).x, 25);
    assert.equal(m.caretAt(L, 7).x, 40);
    assert.equal(m.indexAtPoint(L, 26, 5), 4);
    const rects = plain(m.selectionRects(L, 4, 7));
    assert.deepEqual([rects[0].x, rects[0].w], [25, 15]);
  });
  await t.test('it is drawn a word at a time, where the layout put them', () => {
    const { m, o, log } = setup({ text: 'aaa bbb ccc ddd', bw: 40, align: 'justify' });
    log.length = 0; m.buildText(o);
    assert.deepEqual(plain(log).map(l => [l.text.trim(), l.x]), [['aaa', 0], ['bbb', 25], ['ccc ddd', 0]]);
  });
  await t.test('colored letters are still cut into words and colors', () => {
    const { m, o, log } = setup({ text: 'aaa bbb ccc ddd', bw: 40, align: 'justify', runs: [{ n: 5, c: '#ff0000' }, { n: 10 }] });
    log.length = 0; const r = m.buildText(o);
    assert.deepEqual(plain(log).map(l => l.text.trim()), ['aaa', 'b', 'bb', 'ccc ddd']);
    assert.equal(log[1].x, 25);
    assert.ok(r.parts.length === 2);
  });
  await t.test('it combines with hyphenation: the gaps are smaller on the whole', () => {
    const text = 'The international communication of extraordinary programming languages is wonderful and informative';
    const gaps = o => setup(Object.assign({ text, bw: 90, align: 'justify' }, o)).lay().lines.filter(l => l.slots).map(l => l.gap);
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const hy = setup({ text, bw: 90, align: 'justify', hyph: true }).lay();
    assert.ok(hy.lines.some(l => l.hy), 'some words are broken');
    assert.ok(mean(gaps({ hyph: true })) < mean(gaps({})));
    hy.lines.filter(l => !l.hard && l.slots).forEach(l => assert.ok(Math.abs(l.tw - 90) < 1e-9));
  });
  await t.test('break apart puts each letter where the justified line has it', () => {
    const { m, o } = setup({ text: 'aaa bbb ccc ddd', bw: 40, align: 'justify' });
    const r = m.breakApartText(o);
    assert.equal(r.shapes.length, 12);
    assert.ok(Math.abs(r.shapes[3].x - 25) < 1e-6);
  });
});

test('optical margins: quotes and hyphens hang into the margin', async (t) => {
  await t.test('an opening quote hangs out on the left', () => {
    const L = setup({ text: '"ab', hang: true }).lay();
    assert.equal(L.lines[0].hl, 5);
    assert.equal(L.lines[0].x, -5);
    assert.equal(L.lines[0].tw, 10);
    assert.equal(L.w, 10);
  });
  await t.test('a closing quote or a hyphen hangs out on the right', () => {
    for (const end of ['"', '”', '-']) {
      const L = setup({ text: 'ab' + end, hang: true }).lay();
      assert.equal(L.lines[0].hr, 5, end);
      assert.equal(L.lines[0].tw, 10, end);
    }
  });
  await t.test('only those marks hang, and only at a line\'s edge', () => {
    const L = setup({ text: 'a"b', hang: true }).lay();
    assert.equal(L.lines[0].hl, 0); assert.equal(L.lines[0].hr, 0);
    const em = setup({ text: 'ab—', hang: true }).lay();
    assert.equal(em.lines[0].hr, 0);
    assert.equal(setup({ text: '"ab-' }).lay().lines[0].hl, 0);   // (off unless asked for)
  });
  await t.test('a lone mark does not hang twice', () => {
    const L = setup({ text: '"', hang: true }).lay();
    assert.equal(L.lines[0].hl + L.lines[0].hr, 5);
  });
  await t.test('right and center alignment line up what is left after the hang', () => {
    const right = setup({ text: '"ab\nabc"', hang: true, align: 'right', bw: 100 }).lay();
    // line 1: tw = 10, right edge at 100, so it starts at 90, less its hang
    assert.equal(right.lines[0].x, 90 - 5);
    // line 2: tw = 15 (the quote hangs); it starts at 85
    assert.equal(right.lines[1].x, 85);
    const center = setup({ text: '"ab', hang: true, align: 'center', bw: 100 }).lay();
    assert.equal(center.lines[0].x, 45 - 5);
  });
  await t.test('a hanging mark lets a line hold one more word', () => {
    const base = { text: 'aa" bb', bw: 10 };
    assert.deepEqual(texts(setup(base).lay()).length > 2, true);
    assert.deepEqual(texts(setup(Object.assign({ hang: true }, base)).lay())[0], 'aa" ');
  });
  await t.test('a hyphen added by hyphenation hangs too, so more of the word fits', () => {
    const base = { text: 'hyphenation', bw: 30, hyph: true };
    assert.deepEqual(texts(setup(base).lay())[0], 'hy');
    const L = setup(Object.assign({ hang: true }, base)).lay();
    assert.deepEqual(texts(L)[0], 'hyphen');
    assert.equal(L.lines[0].hr, 5);
    assert.equal(L.lines[0].tw, 30);
  });
  await t.test('justified text hangs too: the letters fill the box, the marks stick out', () => {
    const L = setup({ text: '"aa bb cc dd', bw: 30, align: 'justify', hang: true }).lay();
    const l0 = L.lines[0];
    assert.equal(l0.x, -5);
    assert.ok(Math.abs(l0.tw - 30) < 1e-9);
  });
  await t.test('a number says how much of a mark hangs', () => {
    const half = setup({ text: '"ab-', hang: 0.5 }).lay().lines[0];
    assert.equal(half.hl, 2.5); assert.equal(half.hr, 2.5);
    assert.equal(half.tw, 20 - 5);
    assert.equal(setup({ text: '"ab-', hang: 0 }).lay().lines[0].hl, 0);
    assert.equal(setup({ text: '"ab-', hang: 9 }).lay().lines[0].hl, 7.5);   // (no more than 150%)
    assert.equal(setup({ text: '"ab-', hang: true }).lay().lines[0].hl, 5);
    const L = setup({ text: 'hyphenation', bw: 30, hyph: true, hang: 0.5 }).lay();   // the added hyphen counts for the half that stays in
    assert.equal(L.lines[0].hr, 2.5);
  });
  await t.test('a different amount is a different layout', () => {
    const a = setup({ text: '"ab', hang: 1 }), b = setup({ text: '"ab', hang: 0.5 });
    assert.notEqual(a.m.layoutText(a.o), b.m.layoutText(b.o));
    assert.notEqual(a.m.layoutText(a.o).d, b.m.layoutText(b.o).d);
  });
  await t.test('the layout cache tells hanging and hyphenating texts apart', () => {
    const a = setup({ text: '"ab', hang: true }), b = setup({ text: '"ab' });
    assert.notEqual(a.m.layoutText(a.o), b.m.layoutText(b.o));
  });
});

test('the new settings in the rest of the editor', async (t) => {
  await t.test('they are saved and opened again', () => {
    const { m, o } = setup({ text: 'hyphenation is "fun"', bw: 60, align: 'justify', hang: true, hyph: true });
    m.doc.objects.push(o);
    const back = m.sanitizeDoc(JSON.parse(m.docJSON(m.doc))).objects[0];
    assert.equal(back.align, 'justify'); assert.equal(back.hang, true); assert.equal(back.hyph, true); assert.equal(back.bw, 60);
    assert.equal(back.w, 60);
  });
  await t.test('a part-way hang is saved too, and a silly amount is kept in range', () => {
    const { m, o } = setup({ text: '"ab', hang: 0.4 });
    m.doc.objects.push(o);
    assert.equal(m.sanitizeDoc(JSON.parse(m.docJSON(m.doc))).objects[0].hang, 0.4);
    const d = m.sanitizeDoc({ w: 800, h: 600, objects: [{ kind: 'text', text: 'abc', size: 10, font: 'fake', x: 0, y: 0, hang: 99 }, { kind: 'text', text: 'abc', size: 10, font: 'fake', x: 0, y: 0, hang: -2 }] });
    assert.equal(d.objects[0].hang, 1.5); assert.equal(d.objects[1].hang, undefined);
  });
  await t.test('a drawing without them opens as before', () => {
    const { m } = setup({});
    const d = m.sanitizeDoc({ w: 800, h: 600, objects: [{ kind: 'text', text: 'abc', size: 10, font: 'fake', x: 0, y: 0 }] });
    assert.equal(d.objects[0].hang, undefined); assert.equal(d.objects[0].hyph, undefined); assert.equal(d.objects[0].align, 'left');
  });
  await t.test('nonsense is not kept', () => {
    const { m } = setup({});
    const d = m.sanitizeDoc({ w: 800, h: 600, objects: [{ kind: 'text', text: 'abc', size: 10, font: 'fake', x: 0, y: 0, align: 'full', hang: 'yes', hyph: 1 }] });
    assert.equal(d.objects[0].align, 'left'); assert.equal(d.objects[0].hang, undefined); assert.equal(d.objects[0].hyph, undefined);
  });
  await t.test('becoming a plain shape drops them', () => {
    const { m, o } = setup({ text: 'abc', hang: true, hyph: true, bw: 30 });
    m.toPlainPath(o, 'M0 0L1 1', 1, 1);
    assert.equal(o.hang, undefined); assert.equal(o.hyph, undefined);
  });
  await t.test('break apart gives the hyphen at the end of a line a shape too', () => {
    const { m, o } = setup({ text: 'hyphenation', bw: 40, hyph: true });
    const r = m.breakApartText(o);
    assert.equal(r.shapes.length, 12);
    assert.equal(r.shapes[6].name, '-');
    assert.equal(r.shapes[7].name, 'a');
  });
});

test('paragraph indent: the first line of every paragraph starts further in', async (t) => {
  await t.test('after a line break and at the very start, but not on the lines that wrap', () => {
    const L = setup({ text: 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk\nlll mmm nnn ooo ppp qqq', bw: 100, indent: 2 }).lay();
    const firsts = L.lines.filter((l, i) => i === 0 || L.lines[i - 1].hard);
    assert.equal(firsts.length, 2);
    firsts.forEach(l => { assert.equal(l.x, 20); assert.equal(l.sx, 20); assert.equal(l.sw, 80); });
    L.lines.filter(l => !firsts.includes(l)).forEach(l => { assert.equal(l.x, 0); assert.equal(l.sw, 100); });
  });
  await t.test('the first line has less room, so fewer words fit on it', () => {
    const base = { text: 'aaa bbb ccc ddd eee', bw: 100 };
    assert.deepEqual(texts(setup(base).lay()), ['aaa bbb ccc ddd eee']);   // 19 characters fit in 20
    assert.deepEqual(texts(setup(Object.assign({ indent: 2 }, base)).lay()), ['aaa bbb ccc ddd ', 'eee']);   // only 16 fit now
  });
  await t.test('it is in ems: it grows with the size of the text', () => {
    const L = setup({ text: 'aaa bbb', bw: 400, size: 20, indent: 1.5 }).lay();
    assert.equal(L.lines[0].x, 30);
  });
  await t.test('point text and no indent are as before', () => {
    assert.equal(setup({ text: 'aaa bbb', bw: undefined, indent: 2 }).lay().lines[0].x, 0);
    assert.equal(setup({ text: 'aaa bbb', indent: 0 }).lay().lines[0].x, 0);
    assert.equal(setup({ text: 'aaa bbb', indent: -3 }).lay().lines[0].x, 0);
  });
  await t.test('empty paragraphs have nothing to indent', () => {
    const L = setup({ text: 'aaa\n\nbbb', bw: 100, indent: 2 }).lay();
    assert.deepEqual(plain(L.lines.map(l => l.x)), [20, 20, 20].map((v, i) => i === 1 ? L.lines[1].x : v));
    assert.equal(L.lines.length, 3);
  });
  await t.test('alignment works inside what is left of the first line', () => {
    const c = setup({ text: 'aaa\nbbb', bw: 100, indent: 2, align: 'center' }).lay();
    assert.equal(c.lines[0].x, 20 + (80 - 15) / 2);
    const r = setup({ text: 'aaa\nbbb', bw: 100, indent: 2, align: 'right' }).lay();
    assert.equal(r.lines[0].x + r.lines[0].tw, 100);
  });
  await t.test('a justified first line fills the room it has', () => {
    const L = setup({ text: 'aaa bbb ccc ddd eee fff ggg hhh iii jjj', bw: 100, indent: 2, align: 'justify' }).lay();
    const l = L.lines[0];
    assert.ok(Math.abs(l.tw - l.sw) < 1e-9 && l.sw === 80);
    assert.ok(Math.abs(l.x + l.tw - 100) < 1e-9);
  });
  await t.test('a word too long for the first line is cut, and the text still ends', () => {
    const L = setup({ text: 'c'.repeat(30), bw: 40, indent: 2 }).lay();
    assert.equal(joined(L), 'c'.repeat(30));
    assert.equal(L.lines[0].sw, 20);
  });
  await t.test('it cannot take all of the box', () => {
    const L = setup({ text: 'aaaa bbbb', bw: 40, indent: 50 }).lay();
    assert.ok(L.lines[0].sw >= 10);
    assert.equal(joined(L), 'aaaa bbbb');
  });
  await t.test('the caret follows the indent', () => {
    const { m, lay } = setup({ text: 'aaa bbb', bw: 100, indent: 2 });
    assert.equal(m.caretAt(lay(), 0).x, 20);
  });
  await t.test('a different indent is a different layout, and it is saved and opened', () => {
    const a = setup({ text: 'aaa', bw: 100, indent: 1 }), b = setup({ text: 'aaa', bw: 100, indent: 2 });
    a.m.doc.objects.length = 0; a.m.doc.objects.push(a.o);
    assert.notEqual(a.m.layoutText(a.o).d, b.m.layoutText(b.o).d);
    const back = a.m.sanitizeDoc(JSON.parse(a.m.docJSON(a.m.doc))).objects[0];
    assert.equal(back.indent, 1);
    const d = a.m.sanitizeDoc({ w: 800, h: 600, objects: [{ kind: 'text', text: 'abc', size: 10, font: 'fake', x: 0, y: 0, bw: 50, indent: 999 }, { kind: 'text', text: 'abc', size: 10, font: 'fake', x: 0, y: 0, bw: 50, indent: -1 }, { kind: 'text', text: 'abc', size: 10, font: 'fake', x: 0, y: 0, indent: 'x' }] });
    assert.equal(d.objects[0].indent, 20); assert.equal(d.objects[1].indent, undefined); assert.equal(d.objects[2].indent, undefined);
  });
  await t.test('it combines with hyphenation and with a shape in the way', () => {
    const h = setup({ text: 'an extraordinary result of communication', bw: 80, indent: 1, hyph: true }).lay();
    assert.equal(h.lines[0].x, 10);
    assert.equal(h.lines.map(l => l.text).join(''), 'an extraordinary result of communication');
  });
});

test('paragraph indent: leaving the first paragraph out', async (t) => {
  const base = { text: 'aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk\nlll mmm nnn ooo ppp qqq', bw: 100, indent: 2 };
  const firsts = L => L.lines.filter((l, i) => i === 0 || L.lines[i - 1].hard);
  await t.test('only the very first line is flush; the paragraphs after it are indented', () => {
    const L = setup(Object.assign({ noind1: true }, base)).lay(), f = firsts(L);
    assert.equal(f.length, 2);
    assert.equal(f[0].x, 0); assert.equal(f[0].sw, 100);
    assert.equal(f[1].x, 20); assert.equal(f[1].sw, 80);
  });
  await t.test('the first line then has the whole width to fill', () => {
    const text = 'aaa bbb ccc ddd eee';
    assert.deepEqual(texts(setup({ text, bw: 100, indent: 2 }).lay()), ['aaa bbb ccc ddd ', 'eee']);
    assert.deepEqual(texts(setup({ text, bw: 100, indent: 2, noind1: true }).lay()), [text]);
  });
  await t.test('it does nothing without an indent, and a text of one paragraph just has no indent at all', () => {
    assert.equal(setup({ text: 'aaa bbb', bw: 100, noind1: true }).lay().lines[0].x, 0);
    assert.equal(setup({ text: 'aaa bbb', bw: 100, indent: 2, noind1: true }).lay().lines[0].x, 0);
  });
  await t.test('an empty first paragraph still counts as the first', () => {
    const L = setup({ text: '\naaa', bw: 100, indent: 2, noind1: true }).lay();
    assert.equal(L.lines[1].x, 20);
  });
  await t.test('it works with justify and a shape at the left', () => {
    const J = setup({ text: 'aaa bbb ccc ddd eee fff ggg hhh iii jjj', bw: 100, indent: 2, noind1: true, align: 'justify' }).lay();
    assert.ok(Math.abs(J.lines[0].tw - 100) < 1e-9);
  });
  await t.test('it is a different layout, saved, and opened again', () => {
    const a = setup({ text: 'aaa', bw: 100, indent: 1, noind1: true }), b = setup({ text: 'aaa', bw: 100, indent: 1 });
    assert.notEqual(a.m.layoutText(a.o).d, b.m.layoutText(b.o).d);
    a.m.doc.objects.length = 0; a.m.doc.objects.push(a.o);
    assert.equal(a.m.sanitizeDoc(JSON.parse(a.m.docJSON(a.m.doc))).objects[0].noind1, true);
    const d = a.m.sanitizeDoc({ w: 800, h: 600, objects: [{ kind: 'text', text: 'abc', size: 10, font: 'fake', x: 0, y: 0, bw: 50, indent: 1, noind1: 'yes' }] });
    assert.equal(d.objects[0].noind1, undefined);
  });
});

test('paragraph spacing: room between paragraphs', async (t) => {
  await t.test('every line break adds the gap, an empty paragraph too; lines of one paragraph stay together', () => {
    const L = setup({ text: 'aaa\nbbb\n\nccc', pspace: 1 }).lay();   // a line is 10 tall, the gap 1 em = 10
    assert.deepEqual(plain(L.lines.map(l => l.top)), [0, 20, 40, 60]);
    assert.equal(L.h, 70);
    const W = setup({ text: 'aaa bbb ccc ddd\neee', bw: 40, pspace: 1 }).lay();   // wraps to 3 lines, then a new paragraph
    assert.deepEqual(plain(W.lines.map(l => l.top)), [0, 10, 20, 40].slice(0, W.lines.length - 1).concat([W.lines[W.lines.length - 1].top]));
    assert.equal(W.lines[1].top - W.lines[0].top, 10);
    assert.equal(W.lines[W.lines.length - 1].top - W.lines[W.lines.length - 2].top, 20);
  });
  await t.test('it is in ems, so it grows with the text, and 0 or nothing changes nothing', () => {
    assert.equal(setup({ text: 'a\nb', size: 20, pspace: 0.5 }).lay().lines[1].top, 20 + 10);
    const none = setup({ text: 'a\nb' }).lay(), zero = setup({ text: 'a\nb', pspace: 0 }).lay(), neg = setup({ text: 'a\nb', pspace: -2 }).lay();
    assert.equal(none.lines[1].top, 10); assert.equal(zero.lines[1].top, 10); assert.equal(neg.lines[1].top, 10);
    assert.equal(none.flat, true); assert.equal(zero.flat, true);
  });
  await t.test('a text with a gap is not flat, and a click in the gap, the caret and the selection stay right', () => {
    const { m, lay } = setup({ text: 'aaa\nbbb', pspace: 1 });
    const L = lay();
    assert.equal(L.flat, false);
    assert.equal(m.indexAtPoint(L, 0, 15), 0);        // in the gap: the line above
    assert.equal(m.indexAtPoint(L, 0, 25), 4);        // on the second line
    assert.equal(m.caretAt(L, 4).y0, L.lines[1].base - L.lines[1].asc);
    const r = plain(m.selectionRects(L, 0, 7));
    assert.equal(r.length, 2);
    assert.equal(r[1].y - r[0].y, 20);
    assert.equal(m.verticalMove(L, 1, 1, null).index, 5);
  });
  await t.test('it works with letters of different sizes', () => {
    const L = setup({ text: 'aaa\nbbb', pspace: 1, runs: [{ n: 4, s: 2 }, { n: 3 }] }).lay();
    assert.equal(L.lines[0].h, 20);
    assert.equal(L.lines[1].top, 20 + 10);   // the first line is 20 tall, then the gap of 1 em of the text's size (10)
    assert.equal(L.h, 30 + 10);
  });
  await t.test('the drawing follows the gap', () => {
    const { m, o, log } = setup({ text: 'aaa\nbbb', pspace: 1 });
    log.length = 0; m.buildText(o);
    assert.equal(log[1].y - log[0].y, 20);
  });
  await t.test('it works together with a shape the text wraps around', () => {
    // the second paragraph is at y = 20 (a row of 10 and a gap of 10): a shape there is in its way, one at y 10..20 is only in the gap
    const withRect = (props, r) => {
      const x = setup(props);
      x.m.doc.objects.push(x.m.newShape('rect', Object.assign({ wrap: true, wgap: 0 }, r)));
      x.m.refresh(x.o);
      return x.lay();
    };
    const base = { text: 'aaa\nbbb', bw: 100, pspace: 1 };
    const inGap = withRect(base, { x: 40, y: 10, w: 20, h: 10 });
    assert.equal(inGap.lines[1].sx, 0); assert.equal(inGap.lines[1].sw, 100);
    const inRow = withRect(base, { x: 40, y: 22, w: 20, h: 6 });
    assert.equal(inRow.lines.filter(l => l.top === 20).length, 1);   // (only 'bbb' fits on one side: the rest of the row is the shape's)
    assert.ok(inRow.lines.find(l => l.top === 20).sw < 100);
  });
  await t.test('it is a different layout, saved, opened, and kept in range', () => {
    const a = setup({ text: 'a\nb', pspace: 1 }), b = setup({ text: 'a\nb', pspace: 2 });
    assert.notEqual(a.m.layoutText(a.o).d, b.m.layoutText(b.o).d);
    a.m.doc.objects.length = 0; a.m.doc.objects.push(a.o);
    assert.equal(a.m.sanitizeDoc(JSON.parse(a.m.docJSON(a.m.doc))).objects[0].pspace, 1);
    const mk = v => ({ kind: 'text', text: 'abc', size: 10, font: 'fake', x: 0, y: 0, pspace: v });
    const d = a.m.sanitizeDoc({ w: 800, h: 600, objects: [mk(99), mk(-1), mk('x'), mk(0)] });
    assert.equal(d.objects[0].pspace, 10); assert.equal(d.objects[1].pspace, undefined); assert.equal(d.objects[2].pspace, undefined); assert.equal(d.objects[3].pspace, undefined);
  });
  await t.test('break apart puts the letters where the gap puts them', () => {
    const { m, o } = setup({ text: 'aaa\nbbb', pspace: 1 });
    const r = m.breakApartText(o);
    assert.equal(r.shapes.length, 6);
    assert.ok(r.shapes[3].y - r.shapes[0].y > 15);
  });
});
