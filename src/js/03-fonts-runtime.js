/* =====================================================================
   Fonts. Text is always converted to outlines.
   A font FAMILY (Lato) is a row in the picker; its FACES (Lato Bold Italic) are the fonts the text is really drawn in.
   Every face has a key (kept forever: saved drawings refer to it), so bold and italic are just a different key
   in the same family: there is no faux bold or italic. See BUILD.md to add a font or more weights.
   Where a face's bytes come from depends on the build: the single-file build only has the faces built into the
   page (window.FONT_DATA); the hosted build also fetches the others from the fonts folder (window.FONT_BASE)
   the first time they are used. Either way a face is parsed (opentype.js) only when it is first needed.
   ===================================================================== */
const FONT_CATEGORIES = [
  ['sans', 'Sans'], ['serif', 'Serif'], ['script', 'Script'], ['display', 'Display'],
  ['decorative', 'Decorative'], ['international', 'International'], ['user', 'Yours']
];
// One entry per family: key of its first face, label, category, then optional { w: weight of that first face if it
// isn't 400, faces: [[key, weight, italic?], ...] more weights and italics }. The picker lists them in this order.
// The other weights and italics of most families come from src/fonts/faces.json (window.FONT_FACES), made by scripts/fetch-fonts.js.
const FONT_DEFS = [
  ['inter', 'Inter', 'sans'], ['roboto', 'Roboto', 'sans'], ['open-sans', 'Open Sans', 'sans'],
  ['montserrat', 'Montserrat', 'sans'], ['poppins', 'Poppins', 'sans'],
  ['lato', 'Lato', 'sans'],
  ['work-sans', 'Work Sans', 'sans'],
  ['nunito-xb', 'Nunito', 'sans', { w: 800 }], ['lexend', 'Lexend', 'sans'], ['atkinson', 'Atkinson Hyperlegible', 'sans'],
  ['comic-neue', 'Comic Neue', 'sans'], ['mono', 'Roboto Mono', 'sans'],
  ['lora', 'Lora', 'serif'], ['merriweather', 'Merriweather', 'serif'], ['playfair', 'Playfair Display', 'serif'],
  ['eb-garamond', 'EB Garamond', 'serif'], ['baskerville', 'Libre Baskerville', 'serif'], ['source-serif', 'Source Serif 4', 'serif'],
  ['roboto-slab', 'Roboto Slab', 'serif'], ['cormorant', 'Cormorant Garamond', 'serif'],
  ['pacifico', 'Pacifico', 'script'], ['dancing', 'Dancing Script', 'script'], ['lobster', 'Lobster', 'script'], ['great-vibes', 'Great Vibes', 'script'],
  ['satisfy', 'Satisfy', 'script'], ['sacramento', 'Sacramento', 'script'], ['caveat', 'Caveat', 'script'], ['patrick-hand', 'Patrick Hand', 'script'],
  ['kalam', 'Kalam', 'script'], ['marker', 'Permanent Marker', 'script'],
  ['bungee', 'Bungee', 'display'], ['fredoka', 'Fredoka', 'display', { w: 600 }], ['bebas', 'Bebas Neue', 'display'], ['anton', 'Anton', 'display'],
  ['oswald', 'Oswald', 'display'], ['archivo-black', 'Archivo Black', 'display'], ['abril', 'Abril Fatface', 'display'],
  ['alfa-slab', 'Alfa Slab One', 'display'], ['righteous', 'Righteous', 'display'], ['lilita', 'Lilita One', 'display'], ['cinzel', 'Cinzel', 'display'],
  ['bangers', 'Bangers', 'decorative'], ['luckiest', 'Luckiest Guy', 'decorative'], ['creepster', 'Creepster', 'decorative'],
  ['press-start', 'Press Start 2P', 'decorative'], ['special-elite', 'Special Elite', 'decorative'], ['pirata', 'Pirata One', 'decorative'],
  ['rye', 'Rye', 'decorative'], ['orbitron', 'Orbitron', 'decorative'], ['monoton', 'Monoton', 'decorative'], ['chewy', 'Chewy', 'decorative'],
  ['noto-sans-sc', 'Noto Sans SC', 'international']
];
const FONT_SAMPLES = { 'noto-sans-sc': '中文' };   // what the picker shows for fonts whose name isn't the best sample
const FONT_WEIGHTS = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
const fontStyleName = (w, italic) => w === 400 ? (italic ? 'Italic' : 'Regular') : (FONT_WEIGHTS[w] || String(w)) + (italic ? ' Italic' : '');
const DEFAULT_FONT = 'inter-xb';
const FONT_FACES = window.FONT_FACES || {};   // family key -> [[face key, weight, italic?], ...]
const FONT_BASE = window.FONT_BASE || '';   // the fonts folder of the hosted build; '' in the single file, which has only its built-in fonts
const fonts = {};     // face key -> { label, category, family, weight, italic, styleLabel, font (parsed the first time it is read), data (base64, built in) or buf (fetched or added by the person) }
const FAMILIES = {};  // family key (its regular face) -> { id, label, category, faces: [face keys, lightest first, italics after upright] }
function b64ToBuf(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
const fontAvailable = key => !!(FONT_DATA[key] || FONT_BASE);
function addFace(key, label, category, family, weight, italic) {
  let parsed = null;
  fonts[key] = {
    label, category, family, weight, italic, styleLabel: fontStyleName(weight, italic), data: FONT_DATA[key] || null, buf: null,
    get font() {   // parsed when first needed, so the whole library costs nothing until it is used
      if (parsed) return parsed;
      if (!this.buf && this.data) this.buf = b64ToBuf(this.data);
      if (!this.buf) { fontBytes(key); return key === DEFAULT_FONT ? null : fonts[DEFAULT_FONT].font; }   // still on its way: the default font stands in (see fontArrived)
      try { parsed = opentype.parse(this.buf); } catch (e) { console.error('font', key, e); parsed = key === DEFAULT_FONT ? null : fonts[DEFAULT_FONT].font; }
      return parsed;
    }
  };
}
FONT_DEFS.forEach(([key, label, category, opts]) => {
  opts = opts || {};
  if (!fontAvailable(key)) return;   // not in this build (the single file only has some fonts)
  addFace(key, label, category, key, opts.w || 400, false);
  const faces = [key];
  (opts.faces || FONT_FACES[key] || []).forEach(([fk, w, i]) => {
    if (!fontAvailable(fk)) return;
    addFace(fk, label + ' ' + fontStyleName(w, !!i), category, key, w, !!i);
    faces.push(fk);
  });
  faces.sort((a, b) => fonts[a].weight - fonts[b].weight || +fonts[a].italic - +fonts[b].italic);
  FAMILIES[key] = { id: key, label, category, faces };
});
const fontOf = key => (fonts[key] || fonts[DEFAULT_FONT] || fonts[Object.keys(fonts)[0]]).font;
const fontLoaded = key => !!(fonts[key] && (fonts[key].buf || fonts[key].data));   // its bytes are here (it may not be parsed yet)

/* ---------- getting a font that is not built in ---------- */
const fontLoads = new Map();   // face key -> the fetch in progress
const FONT_MAGIC = ['wOFF', 'OTTO', 'true', '\u0000\u0001\u0000\u0000'];
// The font's bytes: from the page, or fetched from the fonts folder once (the browser's cache keeps them between visits)
function fontBytes(key, force) {
  const f = fonts[key];
  if (!f) return Promise.resolve(null);
  if (f.buf) return Promise.resolve(f.buf);
  if (f.data) { f.buf = b64ToBuf(f.data); return Promise.resolve(f.buf); }
  if (fontLoads.has(key)) return fontLoads.get(key);
  if (!force && f.failedAt && Date.now() - f.failedAt < 15000) return Promise.resolve(null);   // don't hammer a server that just said no
  const p = fetch(FONT_BASE + key + '.woff').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(buf => {
      if (!FONT_MAGIC.includes(String.fromCharCode.apply(null, new Uint8Array(buf.slice(0, 4))))) throw new Error('not a font file');
      f.buf = buf; f.failedAt = 0; fontLoads.delete(key); fontArrived(key);
      return buf;
    })
    .catch(() => { f.failedAt = Date.now(); fontLoads.delete(key); fontFailed(); return null; });
  fontLoads.set(key, p);
  return p;
}
// Make sure these faces are here. Says whether every one of them is.
function ensureFonts(keys, force) {
  return Promise.all(Array.from(new Set(keys)).filter(k => fonts[k]).map(k => fontBytes(k, force))).then(r => r.every(Boolean));
}
// ... but never wait longer than ms, so opening a drawing is not held up by a slow connection (see fontArrived)
const fontsWithin = (keys, ms) => Promise.race([ensureFonts(keys), new Promise(r => setTimeout(() => r(false), ms))]);
// The faces the text objects of a drawing (not yet cleaned up) ask for
const rawFontKeys = raw => (raw && Array.isArray(raw.objects) ? raw.objects : []).filter(o => o && o.kind === 'text' && typeof o.font === 'string' && fonts[o.font]).map(o => o.font);
// A face that was used before it arrived was laid out in the default font: lay it out again in its own
function fontArrived(key) {
  try {
    Array.from(textLayouts.keys()).forEach(k => { if (k.startsWith(key + '|')) textLayouts.delete(k); });
    let any = false;
    doc.objects.forEach(o => { if (o.kind === 'text' && o.font === key) { refresh(o); any = true; } });
    if (any) refreshAll();
  } catch (e) { /* the drawing isn't ready yet; it is laid out when it is */ }
}
let fontFailToast = 0;
function fontFailed() {
  if (Date.now() - fontFailToast < 10000) return;
  fontFailToast = Date.now();
  toast(location.protocol === 'file:'
    ? 'A font could not be loaded. FriendShaped fetches fonts from its fonts folder, so open it from a web address, or use the single-file version.'
    : 'A font could not be loaded. Are you offline? Inter is shown instead.');
}

/* ---------- bold and italic: the other faces of a family ---------- */
// The face of a family closest to a weight, with the wanted slant if the family has it (else upright)
function nearestFace(family, weight, italic) {
  const F = FAMILIES[family]; if (!F) return null;
  let pool = F.faces.filter(k => fonts[k].italic === !!italic);
  if (!pool.length) pool = F.faces;
  return pool.reduce((best, k) => {
    const d = Math.abs(fonts[k].weight - weight) + (fonts[k].weight > weight ? 0.1 : 0), e = Math.abs(fonts[best].weight - weight) + (fonts[best].weight > weight ? 0.1 : 0);
    return d < e ? k : best;   // a tie goes to the lighter one
  });
}
const faceIsBold = key => fonts[key].weight >= 600;
// What the Bold button switches to: the regular weight if the text is bold now, else the bold weight (the same face if there is none)
const boldToggled = key => nearestFace(fonts[key].family, faceIsBold(key) ? 400 : 700, fonts[key].italic);
const italicToggled = key => nearestFace(fonts[key].family, fonts[key].weight, !fonts[key].italic);
// Picking another family keeps what the text is: bold stays bold and italic stays italic where the new family has them
const faceForFamily = (family, fromKey) => nearestFace(family, fonts[fromKey] && faceIsBold(fromKey) ? 700 : 400, !!(fonts[fromKey] && fonts[fromKey].italic));

// The same fonts for the browser's own text drawing (the picker's previews, typing in place). Loaded once, when first asked for.
const cssFamily = key => 'friendshaped-' + String(key).replace(/[^\w-]/g, '_');
const faceLoads = new Map();
function fontFaceReady(key) {
  if (!faceLoads.has(key)) {
    const p = fontBytes(key).then(buf => {
      if (!buf) { faceLoads.delete(key); return; }   // not here yet: try again next time it is asked for
      const ff = new FontFace(cssFamily(key), buf.slice(0));
      document.fonts.add(ff);
      return ff.load();
    });
    faceLoads.set(key, p.catch(() => { /* the browser's fallback font is used */ }));
  }
  return faceLoads.get(key);
}
// Characters of an object's text that its font has no letter for (they would draw as nothing)
function missingGlyphs(o) {
  if (!fontLoaded(o.font)) return [];   // still on its way: the default font standing in would say the wrong thing
  const font = fontOf(o.font), out = [];
  for (const ch of String(o.text || '')) {
    if (/\s/.test(ch) || out.indexOf(ch) >= 0) continue;
    if (font.charToGlyphIndex(ch) === 0) out.push(ch);
  }
  return out;
}

// Wordmark: the app's own text-to-outline in Bungee
(function wordmark() {
  try {
    const f = fontOf('bungee'), size = 20, opts = { kerning: true, letterSpacing: 0.02 };
    const w = f.getAdvanceWidth('FRIENDSHAPED', size, opts);
    const svg = $('#wordmark');
    svg.setAttribute('viewBox', '0 0 ' + Math.ceil(w) + ' 22');
    svg.setAttribute('width', Math.ceil(w));
    const p = svgEl('path', { d: f.getPath('FRIENDSHAPED', 0, 18.5, size, opts).toPathData(2) });
    svg.appendChild(p);
  } catch (e) { $('#wordmark').outerHTML = '<b>FriendShaped</b>'; }
})();

