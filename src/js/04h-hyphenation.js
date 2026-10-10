/* =====================================================================
   Hyphenation: where an English word may be broken across two lines (Liang's method, the one TeX uses)
   The patterns are in 04h-hyphen-data.js. hyphenPoints('hyphenation') says the word may be split after 2, 5, 7 and 8
   letters. It only knows English, and only plain letters: a word with an apostrophe, a digit, an accent or any other mark
   is left whole, as is a word in capitals (nobody hyphenates a heading shouted in capitals). No DOM, so it is unit tested.
   ===================================================================== */
const HYPH_LEFT_MIN = 2, HYPH_RIGHT_MIN = 3, HYPH_WORD_MIN = 5;   // letters kept before the hyphen / after it / the shortest word that is broken

// Words the patterns get wrong that we have noticed (the TeX list above has the same flaw for 'democrat': de-mo-c-rat)
const HYPH_FIXES = ['dem-o-crat', 'dem-o-crats', 'dem-o-crat-ic'];

let hyphTable = null;   // { map: letters -> digits, exc: word -> places, max: the longest pattern }
function hyphBuild() {
  const map = new Map(), exc = new Map();
  let max = 0;
  HYPH_EN_PATTERNS.forEach(p => {
    let letters = '', digits = [], pend = 0;
    for (const ch of p) {
      if (ch >= '0' && ch <= '9') pend = +ch;
      else { digits.push(pend); pend = 0; letters += ch; }
    }
    digits.push(pend);   // (one more place than letters: before each letter, and after the last)
    map.set(letters, digits);
    max = Math.max(max, letters.length);
  });
  HYPH_EN_EXCEPTIONS.concat(HYPH_FIXES).forEach(w => {
    const at = []; let n = 0;
    for (const ch of w) { if (ch === '-') at.push(n); else n++; }
    exc.set(w.replace(/-/g, ''), at);
  });
  return { map, exc, max };
}

const hyphCache = new Map();   // (a word that has been looked up -> its places; kept small)

// The places a word may be broken: [n, ...] where n is how many letters stay before the hyphen. [] if it can't be broken.
function hyphenPoints(word) {
  if (typeof word !== 'string' || word.length < HYPH_WORD_MIN || !/^[A-Za-z]+$/.test(word)) return [];
  if (word.length > 1 && word === word.toUpperCase()) return [];
  const w = word.toLowerCase(), hit = hyphCache.get(w);
  if (hit) return hit;
  if (!hyphTable) hyphTable = hyphBuild();
  const { map, exc, max } = hyphTable, len = w.length;
  let out;
  if (exc.has(w)) out = exc.get(w).filter(n => n >= HYPH_LEFT_MIN && len - n >= HYPH_RIGHT_MIN);
  else {
    const s = '.' + w + '.', pts = new Array(s.length + 1).fill(0);
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j <= Math.min(s.length, i + max); j++) {
        const d = map.get(s.slice(i, j));
        if (d) for (let k = 0; k < d.length; k++) if (d[k] > pts[i + k]) pts[i + k] = d[k];
      }
    }
    out = [];
    for (let n = HYPH_LEFT_MIN; len - n >= HYPH_RIGHT_MIN; n++) if (pts[n + 1] % 2 === 1) out.push(n);
  }
  if (hyphCache.size > 5000) hyphCache.clear();
  hyphCache.set(w, out);
  return out;
}
