/* =====================================================================
   Helpers
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const APP_VERSION = '__APP_VERSION__';   // filled in by build.js from package.json
const SVGNS = 'http://www.w3.org/2000/svg';
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (v, p = 2) => { const m = Math.pow(10, p); return Math.round(v * m) / m; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
  return e;
}
function elt(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
// Set an attribute only when it changed (keeps drags cheap)
function setA(e, k, v) {
  const c = e._c || (e._c = {});
  if (c[k] === v) return;
  c[k] = v;
  if (v === null || v === undefined || v === '') e.removeAttribute(k); else e.setAttribute(k, v);
}
function rotPt(px, py, cx, cy, deg) {
  const a = deg * D2R, c = Math.cos(a), s = Math.sin(a), dx = px - cx, dy = py - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}
const normDeg = d => { d = ((d + 180) % 360 + 360) % 360 - 180; return d === -180 ? 180 : d; };

