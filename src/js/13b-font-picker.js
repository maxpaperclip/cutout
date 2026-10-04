/* =====================================================================
   Font picker
   A button showing the current font family (in the typeface of the face in use) that opens a list: category chips along
   the top, a search box, and every family's name set in its own regular face. Fonts are loaded for the browser's own
   drawing only as their rows scroll into view (see fontFaceReady in 03-fonts-runtime.js).
   Under the button: a Style menu listing the faces of the family (Light, Bold Italic ...) and Bold and Italic
   buttons that move to the matching face. A family without a bold or italic face has that button switched off:
   nothing is ever faked. Picking a family keeps bold and italic where the new family has them.
   "Yours" holds fonts added from the computer; they are kept in this browser (the 'meta' store, key 'font:...')
   so they are still there next time. A face is chosen by setting o.font on the selected text (setTextFace).
   ===================================================================== */
const FP = { cat: 'all', q: '', active: -1, shown: null };
const fpBtn = $('#tx-font'), fpPop = $('#fp-pop'), fpQ = $('#fp-q'), fpList = $('#fp-list'), fpTabs = $('#fp-tabs');
const fpStyle = $('#tx-style'), fpBold = $('#tx-bold'), fpItalic = $('#tx-italic');
const fpIsOpen = () => !fpPop.hidden;
const fpFamily = k => "'" + cssFamily(k) + "', sans-serif";
const fpText = k => FAMILIES[k].label + (FONT_SAMPLES[k] ? ' · ' + FONT_SAMPLES[k] : '');

// The button's own label, and the Style menu and Bold and Italic buttons that go with it
function fpSetValue(key) {
  if (FP.shown === key) return;
  FP.shown = key;
  const f = fonts[key], F = FAMILIES[f.family];
  const n = $('#fp-name'); n.textContent = F.label;
  fontFaceReady(key).then(() => { if (FP.shown === key) n.style.fontFamily = fpFamily(key); });
  fpStyle.textContent = '';
  F.faces.forEach(k => { const op = elt('option', '', fonts[k].styleLabel); op.value = k; fpStyle.appendChild(op); });
  fpStyle.value = key; fpStyle.disabled = F.faces.length < 2;
  const b = boldToggled(key), i = italicToggled(key);
  fpBold.setAttribute('aria-pressed', String(faceIsBold(key)));
  fpBold.disabled = faceIsBold(b) === faceIsBold(key);
  fpBold.title = fpBold.disabled ? F.label + ' has no ' + (faceIsBold(key) ? 'regular' : 'bold') + ' style' : 'Bold (Ctrl+B)';
  fpItalic.setAttribute('aria-pressed', String(f.italic));
  fpItalic.disabled = fonts[i].italic === f.italic;
  fpItalic.title = fpItalic.disabled ? F.label + ' has no italic style' : 'Italic (Ctrl+I)';
}

// Use this face for the selected text. A face that is not here yet is fetched first, so the text never flashes in another font.
async function setTextFace(key) {
  const o = one();
  if (!o || o.kind !== 'text' || !fonts[key] || o.font === key) return;
  const id = o.id, slow = setTimeout(() => toast('Loading ' + fonts[key].label + '…'), 400);
  const ok = await ensureFonts([key], true);
  clearTimeout(slow);
  const t = byId(id);
  if (!ok || !t || t.kind !== 'text') {   // (a face that could not be fetched has already said so)
    if (fonts[FP.shown]) fpStyle.value = FP.shown;   // the menu goes back to the face the text really has
    return;
  }
  t.font = key; refresh(t); commit();
  if (te && te.id === id) fontFaceReady(key).then(() => { if (te && te.id === id) tePlace(); });   // typing in place: the box takes the new face
}
// Bold or italic on or off for the selected text, by moving to the matching face. say: tell the person when there isn't one (a shortcut gives no other sign).
function toggleStyle(which, say) {
  const o = one();
  if (!o || o.kind !== 'text' || !fonts[o.font]) return;
  const to = which === 'bold' ? boldToggled(o.font) : italicToggled(o.font), same = which === 'bold' ? faceIsBold(to) === faceIsBold(o.font) : fonts[to].italic === fonts[o.font].italic;
  if (same) { if (say) toast(FAMILIES[fonts[o.font].family].label + ' has no ' + which + ' style.'); return; }
  setTextFace(to);
}
fpStyle.addEventListener('change', () => setTextFace(fpStyle.value));
fpBold.addEventListener('click', () => toggleStyle('bold'));
fpItalic.addEventListener('click', () => toggleStyle('italic'));

function fpTabsRender() {
  fpTabs.textContent = '';
  [['all', 'All']].concat(FONT_CATEGORIES).forEach(([c, name]) => {
    const b = elt('button', 'chip', name); b.type = 'button'; b.dataset.cat = c; b.setAttribute('aria-pressed', String(FP.cat === c));
    fpTabs.appendChild(b);
  });
}
const fpIO = 'IntersectionObserver' in window
  ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { fpIO.unobserve(e.target); fpStyleRow(e.target); } }), { root: fpList, rootMargin: '120px' })
  : null;
function fpStyleRow(li) {
  const k = li.dataset.key;
  fontFaceReady(k).then(() => { const l = li.querySelector('.fp-label'); if (l) l.style.fontFamily = fpFamily(k); });
}
function fpRender() {
  if (fpIO) fpIO.disconnect();
  fpList.textContent = '';
  const q = FP.q.trim().toLowerCase(), cur = FP.shown && fonts[FP.shown] ? fonts[FP.shown].family : null;
  let count = 0;
  FONT_CATEGORIES.forEach(([c, cname]) => {
    if (FP.cat !== 'all' && FP.cat !== c) return;
    const keys = Object.keys(FAMILIES).filter(k => FAMILIES[k].category === c && (!q || FAMILIES[k].label.toLowerCase().includes(q) || cname.toLowerCase().includes(q)));
    if (!keys.length) return;
    if (FP.cat === 'all') { const h = elt('li', 'fp-head', cname); h.setAttribute('role', 'presentation'); fpList.appendChild(h); }
    keys.forEach(k => {
      const li = elt('li', ''); li.id = 'fp-o' + count++; li.dataset.key = k; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(k === cur));
      li.appendChild(elt('span', 'fp-label', fpText(k)));
      if (FAMILIES[k].category === 'user') {
        const x = elt('button', 'fp-x', '×'); x.type = 'button'; x.title = 'Remove this font'; x.setAttribute('aria-label', 'Remove ' + FAMILIES[k].label);
        li.appendChild(x);
      }
      fpList.appendChild(li);
      if (fpIO) fpIO.observe(li); else fpStyleRow(li);
    });
  });
  if (!count) {
    const e = elt('li', 'fp-empty', FP.cat === 'user' && !q ? 'Fonts you add from your computer show up here, and stay in this browser.' : 'No fonts match.');
    e.setAttribute('role', 'presentation'); fpList.appendChild(e);
  }
  FP.active = -1;
  fpQ.removeAttribute('aria-activedescendant');
}
function fpActivate(i, scroll) {
  const rows = $$('#fp-list [role=option]');
  if (!rows.length) return;
  FP.active = clamp(i, 0, rows.length - 1);
  rows.forEach((r, n) => r.classList.toggle('active', n === FP.active));
  fpQ.setAttribute('aria-activedescendant', rows[FP.active].id);
  if (scroll !== false) rows[FP.active].scrollIntoView({ block: 'nearest' });
}
function fpOpenPop() {
  const o = one(); if (!o || o.kind !== 'text') return;
  fpSetValue(fonts[o.font] ? o.font : DEFAULT_FONT);
  FP.q = ''; fpQ.value = '';
  fpTabsRender(); fpRender();
  fpPop.hidden = false; fpBtn.setAttribute('aria-expanded', 'true');
  const rows = $$('#fp-list [role=option]'), at = rows.findIndex(r => r.dataset.key === fonts[FP.shown].family);
  if (at >= 0) { fpActivate(at); rows[at].scrollIntoView({ block: 'center' }); }
  fpQ.focus({ preventScroll: true });
}
function fpClosePop(focusBtn) {
  if (!fpIsOpen()) return;
  fpPop.hidden = true; fpBtn.setAttribute('aria-expanded', 'false');
  if (focusBtn) fpBtn.focus({ preventScroll: true });
}
// A row is a family: the text keeps its bold and italic where the family has them
function fpPick(family) {
  const o = one();
  if (o && o.kind === 'text' && FAMILIES[family]) setTextFace(faceForFamily(family, o.font));
  fpClosePop(true);
}

fpBtn.addEventListener('click', () => fpIsOpen() ? fpClosePop(false) : fpOpenPop());
fpBtn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' && !fpIsOpen()) { e.preventDefault(); fpOpenPop(); } });
fpTabs.addEventListener('click', e => {
  const b = e.target.closest('button[data-cat]'); if (!b) return;
  FP.cat = b.dataset.cat; fpTabsRender(); fpRender(); fpActivate(0, false); fpQ.focus({ preventScroll: true });
});
fpQ.addEventListener('input', () => { FP.q = fpQ.value; fpRender(); if (FP.q.trim()) fpActivate(0, false); });
fpQ.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); fpActivate(FP.active + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); fpActivate(Math.max(FP.active, 1) - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); const r = $$('#fp-list [role=option]')[FP.active]; if (r) fpPick(r.dataset.key); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fpClosePop(true); }
});
fpList.addEventListener('click', e => {
  const li = e.target.closest('[role=option]'); if (!li) return;
  if (e.target.closest('.fp-x')) { removeUserFont(li.dataset.key); return; }
  fpPick(li.dataset.key);
});
document.addEventListener('pointerdown', e => { if (fpIsOpen() && !e.target.closest('#fontpick')) fpClosePop(false); });

/* ---------- fonts added from the computer ---------- */
// A font from the computer is a family of one face
function registerUserFont(key, label, font, buf) {
  fonts[key] = { label, category: 'user', family: key, weight: 400, italic: false, styleLabel: 'Regular', font, buf, data: null };
  FAMILIES[key] = { id: key, label, category: 'user', faces: [key] };
}
async function addUserFont(file) {
  const buf = await file.arrayBuffer();
  const font = opentype.parse(buf);
  const fam = (font.names && font.names.fontFamily && (font.names.fontFamily.en || Object.values(font.names.fontFamily)[0])) || file.name.replace(/\.[^.]+$/, '');
  const key = 'user:' + fam + ':' + Date.now();
  registerUserFont(key, fam, font, buf);
  let kept = false;
  if (DB.ok) { try { await idbPut('meta', { key: 'font:' + key, label: fam, buf }); kept = true; } catch (e) { /* the font works for this session only */ } }
  return { key, fam, kept };
}
async function loadUserFonts() {
  if (!DB.ok) return;
  try {
    const keys = (await idbKeys('meta')).filter(k => typeof k === 'string' && k.startsWith('font:'));
    for (const k of keys) {
      try {
        const r = await idbGet('meta', k);
        if (r && r.buf) registerUserFont(k.slice(5), r.label, opentype.parse(r.buf.slice(0)), r.buf);
      } catch (e) { /* a font that cannot be read is skipped */ }
    }
  } catch (e) { /* none */ }
}
function removeUserFont(key) {
  const f = fonts[key]; if (!f || f.category !== 'user') return;
  delete fonts[key]; delete FAMILIES[key]; faceLoads.delete(key);
  if (DB.ok) idbDel('meta', 'font:' + key).catch(() => { /* it is gone for this session either way */ });
  let used = 0;
  doc.objects.forEach(o => { if (o.kind === 'text' && o.font === key) { o.font = DEFAULT_FONT; refresh(o); used++; } });
  if (used) commit();
  FP.shown = null;
  const o = one(); if (o && o.kind === 'text') fpSetValue(fonts[o.font] ? o.font : DEFAULT_FONT);
  fpRender();
  refreshAll();
  toast('Removed “' + f.label + '”.' + (used ? ' Text that used it now shows in Inter.' : ''));
}
