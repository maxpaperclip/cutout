/* =====================================================================
   Fonts (embedded, parsed on first use). Text is always converted to outlines.
   Each font has a key (kept forever: saved drawings refer to it), a label and a category for the picker
   (see 13b-font-picker.js). The picker lists them in this order within each category. See BUILD.md to add one.
   ===================================================================== */
const FONT_CATEGORIES = [
  ['sans', 'Sans'], ['serif', 'Serif'], ['script', 'Script'], ['display', 'Display'],
  ['decorative', 'Decorative'], ['international', 'International'], ['user', 'Yours']
];
const FONT_DEFS = [
  // key, label, category
  ['inter', 'Inter', 'sans'], ['inter-xb', 'Inter Extra Bold', 'sans'], ['roboto', 'Roboto', 'sans'], ['open-sans', 'Open Sans', 'sans'],
  ['montserrat', 'Montserrat', 'sans'], ['poppins', 'Poppins', 'sans'], ['lato', 'Lato', 'sans'], ['work-sans', 'Work Sans', 'sans'],
  ['nunito-xb', 'Nunito Extra Bold', 'sans'], ['lexend', 'Lexend', 'sans'], ['atkinson', 'Atkinson Hyperlegible', 'sans'],
  ['comic-neue', 'Comic Neue', 'sans'], ['mono', 'Roboto Mono', 'sans'],
  ['lora', 'Lora', 'serif'], ['lora-b', 'Lora Bold', 'serif'], ['merriweather', 'Merriweather', 'serif'], ['playfair', 'Playfair Display', 'serif'],
  ['eb-garamond', 'EB Garamond', 'serif'], ['baskerville', 'Libre Baskerville', 'serif'], ['source-serif', 'Source Serif 4', 'serif'],
  ['roboto-slab', 'Roboto Slab', 'serif'], ['cormorant', 'Cormorant Garamond', 'serif'],
  ['pacifico', 'Pacifico', 'script'], ['dancing', 'Dancing Script', 'script'], ['lobster', 'Lobster', 'script'], ['great-vibes', 'Great Vibes', 'script'],
  ['satisfy', 'Satisfy', 'script'], ['sacramento', 'Sacramento', 'script'], ['caveat', 'Caveat', 'script'], ['patrick-hand', 'Patrick Hand', 'script'],
  ['kalam', 'Kalam', 'script'], ['marker', 'Permanent Marker', 'script'],
  ['bungee', 'Bungee', 'display'], ['fredoka', 'Fredoka SemiBold', 'display'], ['bebas', 'Bebas Neue', 'display'], ['anton', 'Anton', 'display'],
  ['oswald', 'Oswald', 'display'], ['archivo-black', 'Archivo Black', 'display'], ['abril', 'Abril Fatface', 'display'],
  ['alfa-slab', 'Alfa Slab One', 'display'], ['righteous', 'Righteous', 'display'], ['lilita', 'Lilita One', 'display'], ['cinzel', 'Cinzel', 'display'],
  ['bangers', 'Bangers', 'decorative'], ['luckiest', 'Luckiest Guy', 'decorative'], ['creepster', 'Creepster', 'decorative'],
  ['press-start', 'Press Start 2P', 'decorative'], ['special-elite', 'Special Elite', 'decorative'], ['pirata', 'Pirata One', 'decorative'],
  ['rye', 'Rye', 'decorative'], ['orbitron', 'Orbitron', 'decorative'], ['monoton', 'Monoton', 'decorative'], ['chewy', 'Chewy', 'decorative'],
  ['noto-sans-sc', 'Noto Sans SC', 'international']
];
const FONT_SAMPLES = { 'noto-sans-sc': '\u4e2d\u6587' };   // what the picker shows for fonts whose name isn't the best sample
const DEFAULT_FONT = 'inter-xb';
const fonts = {};   // key -> { label, category, font (parsed the first time it is read), data (base64) or buf (an uploaded font) }
function b64ToBuf(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
FONT_DEFS.forEach(([key, label, category]) => {
  if (!FONT_DATA[key]) { console.error('font missing', key); return; }
  let parsed = null;
  fonts[key] = {
    label, category, data: FONT_DATA[key],
    get font() {   // parsed when first needed, so the whole library costs nothing until it is used
      if (!parsed) { try { parsed = opentype.parse(b64ToBuf(FONT_DATA[key])); } catch (e) { console.error('font', key, e); parsed = key === DEFAULT_FONT ? null : fonts[DEFAULT_FONT].font; } }
      return parsed;
    }
  };
});
const fontOf = key => (fonts[key] || fonts[DEFAULT_FONT] || fonts[Object.keys(fonts)[0]]).font;
// The same fonts for the browser's own text drawing (the picker's previews, typing in place). Loaded once, when first asked for.
const cssFamily = key => 'cutout-' + String(key).replace(/[^\w-]/g, '_');
const faceLoads = new Map();
function fontFaceReady(key) {
  if (!faceLoads.has(key)) {
    let p;
    try {
      const f = fonts[key], ff = new FontFace(cssFamily(key), f.buf ? f.buf.slice(0) : b64ToBuf(f.data));
      document.fonts.add(ff); p = ff.load();
    } catch (_) { p = Promise.resolve(); }
    faceLoads.set(key, p.catch(() => { /* the browser's fallback font is used */ }));
  }
  return faceLoads.get(key);
}
// Characters of an object's text that its font has no letter for (they would draw as nothing)
function missingGlyphs(o) {
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
    const w = f.getAdvanceWidth('CUTOUT', size, opts);
    const svg = $('#wordmark');
    svg.setAttribute('viewBox', '0 0 ' + Math.ceil(w) + ' 22');
    svg.setAttribute('width', Math.ceil(w));
    const p = svgEl('path', { d: f.getPath('CUTOUT', 0, 18.5, size, opts).toPathData(2) });
    svg.appendChild(p);
  } catch (e) { $('#wordmark').outerHTML = '<b>Cutout</b>'; }
})();

