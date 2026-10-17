'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const opentype = require('opentype.js');

// Every font in the library is a file FriendShaped ships to every student and reads with opentype.js, so each one is
// checked here the way the October 2026 review did (see SECURITY-REVIEW.md): a well-formed WOFF with nothing hidden
// in it, made only of the kinds of tables that review covered, and every glyph drawable. A font that fails is not
// necessarily bad, but it is new ground: look at it (and run scripts/verify-fonts.js) before changing this test.
const FONTS = path.join(__dirname, '..', 'src', 'fonts');
const files = fs.readdirSync(FONTS).filter((f) => f.endsWith('.woff')).sort();

// The tables the reviewed fonts have. Notably absent: CFF/CFF2 outlines and TrueType hinting programs (fpgm, prep,
// cvt), where opentype.js 1.3.4 has known crash bugs (fixed upstream in 1.3.5, which FriendShaped can't use yet).
const REVIEWED_TABLES = new Set(['BASE', 'GDEF', 'GPOS', 'GSUB', 'OS/2', 'STAT', 'cmap', 'gasp', 'glyf', 'head', 'hhea', 'hmtx',
  'kern', 'loca', 'maxp', 'name', 'post', 'vhea', 'vmtx']);

// The WOFF 1.0 header and table directory (https://www.w3.org/TR/WOFF/)
function readWoff(buf) {
  assert.equal(buf.toString('latin1', 0, 4), 'wOFF', 'not a WOFF file');
  const length = buf.readUInt32BE(8), numTables = buf.readUInt16BE(12);
  const metaLength = buf.readUInt32BE(28), privLength = buf.readUInt32BE(40);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const at = 44 + 20 * i;
    tables.push({ tag: buf.toString('latin1', at, at + 4), offset: buf.readUInt32BE(at + 4), compLength: buf.readUInt32BE(at + 8), origLength: buf.readUInt32BE(at + 12) });
  }
  return { length, numTables, metaLength, privLength, tables, dirEnd: 44 + 20 * numTables };
}

test('font files: every font in the library is a clean, drawable WOFF', async (t) => {
  assert.ok(files.length > 300, 'the whole library is here');
  for (const file of files) {
    await t.test(file, () => {
      const buf = fs.readFileSync(path.join(FONTS, file)), w = readWoff(buf);
      // nothing hidden: the length matches, no extra metadata or private data, no gaps or bytes after the tables
      assert.equal(w.length, buf.length, 'the header gives the real length');
      assert.equal(w.metaLength, 0, 'no metadata block');
      assert.equal(w.privLength, 0, 'no private data block');
      let pos = w.dirEnd;
      w.tables.slice().sort((a, b) => a.offset - b.offset).forEach((tb) => {
        assert.ok(REVIEWED_TABLES.has(tb.tag), `table "${tb.tag}" is of a kind not reviewed yet`);
        const gap = tb.offset - pos;
        assert.ok(gap >= 0 && gap <= 3, `${tb.tag}: ${gap} bytes before it (only 0-3 bytes of padding are allowed)`);
        const data = buf.subarray(tb.offset, tb.offset + tb.compLength);
        assert.equal(data.length, tb.compLength, `${tb.tag} runs past the end of the file`);
        const raw = tb.compLength < tb.origLength ? zlib.inflateSync(data) : data;
        assert.equal(raw.length, tb.origLength, `${tb.tag} unpacks to the size it says`);
        pos = tb.offset + tb.compLength;
      });
      assert.ok(buf.length - pos <= 3, `${buf.length - pos} bytes after the last table`);
      // every glyph draws, as FriendShaped draws text (a looping composite glyph would throw here)
      const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
      for (let i = 0; i < font.numGlyphs; i++) {
        const d = font.glyphs.get(i).getPath(0, 0, 72).toPathData(2);
        assert.ok(!/NaN|Infinity/.test(d), `glyph ${i} has a broken outline`);
      }
    });
  }
});
