/* =====================================================================
   Rendering: canvas objects
   ===================================================================== */
const stage = $('#stage'), world = $('#world'), layerG = $('#layer'), ov = $('#overlay');
const els = new Map(), defEls = new Map(), picDefs = $('#pic-defs');

/* Keeping live elements in step with objView (see 05-svg-export.js). Elements are reused whenever
   the tag still matches, and setA only touches attributes that changed, so a drag stays cheap. */
const blank = v => v === null || v === undefined || v === '';
function patchAttrs(el, a) {
  const had = el._keys, now = [];
  for (const k in a) { const v = a[k]; if (blank(v)) continue; setA(el, k, v); now.push(k); }
  if (had) for (let i = 0; i < had.length; i++) { const k = had[i]; if (blank(a[k])) setA(el, k, null); }   // settings that went away
  el._keys = now;
}
function patchKids(parent, nodes) {
  let el = parent.firstElementChild;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!el || el.tagName !== n.tag) { const fresh = svgEl(n.tag); if (el) parent.replaceChild(fresh, el); else parent.appendChild(fresh); el = fresh; }
    patchAttrs(el, n.a || {});
    if (n.kids) patchKids(el, n.kids); else while (el.firstElementChild) el.firstElementChild.remove();
    el = el.nextElementSibling;
  }
  while (el) { const next = el.nextElementSibling; el.remove(); el = next; }   // anything left over
}

function syncObjects() {
  wrapSyncAll();   // (texts that flow around shapes are laid out again when a shape has moved)
  const seen = new Set();
  doc.objects.forEach(o => {
    seen.add(o.id);
    let g = els.get(o.id);
    if (!g) { g = svgEl('g'); g.dataset.id = o.id; els.set(o.id, g); }
    const v = objView(o, { grad: 'gr-' + o.id, clip: 'pc-' + o.id, mask: 'em-' + o.id });
    // its definitions (gradient, photo clip, erase mask) live in <defs>, in a holder of their own
    let dg = defEls.get(o.id);
    if (v.defs.length) { if (!dg) { dg = svgEl('g'); picDefs.appendChild(dg); defEls.set(o.id, dg); } patchKids(dg, v.defs); }
    else if (dg) { dg.remove(); defEls.delete(o.id); }
    patchAttrs(g, Object.assign({}, v.node.a, { display: isHidden(o) ? 'none' : null, 'pointer-events': o.paint ? 'none' : null }));   // a paint layer covers the page, so clicks go through it (pick it in Layers)   // hidden, or inside a hidden group
    // Anything drawn only as an outline (lines, drawn lines, shapes with no fill) gets a wider,
    // invisible outline to click on, so thin strokes are easy to select
    const kids = v.node.kids.slice();
    if (hasPaint(o) && !hasPic(o) && !hasGrad(o) && (!o.fill || o.fill === 'none'))
      kids.push({ tag: v.spec.tag, a: Object.assign({}, v.spec.a, { class: 'obj-hit', 'stroke-width': rnd(Math.max(o.sw || 0, 16 / view.z), 3) }) });
    // A text is picked anywhere in its box, not only on its letters: an invisible rectangle over the whole box
    if (o.kind === 'text') kids.push({ tag: 'rect', a: { x: 0, y: 0, width: rnd(o.w, 2), height: rnd(o.h, 2), transform: objXf(o), class: 'text-hit' } });   // (placed like the letters are, so it turns and moves with them)
    patchKids(g, kids);
  });
  els.forEach((g, id) => { if (!seen.has(id)) { g.remove(); els.delete(id); } });
  defEls.forEach((dg, id) => { if (!seen.has(id)) { dg.remove(); defEls.delete(id); } });
  let ref = layerG.firstChild;
  doc.objects.forEach(o => {
    const g = els.get(o.id);
    if (g === ref) ref = ref.nextSibling; else layerG.insertBefore(g, ref);
  });
}

/* ---------- artboard, grid, view ---------- */
const abBg = $('#ab-bg'), abFrame = $('#ab-frame'), gridRect = $('#grid-rect'), gridPat = $('#gridpat'), gridPath = $('#gridpath'), outside = $('#outside');
function drawArtboard() {
  [abBg, abFrame, gridRect].forEach(r => { setA(r, 'width', doc.w); setA(r, 'height', doc.h); });
  setA(abBg, 'fill', doc.bg === 'transparent' ? 'url(#checker)' : doc.bg);
  const showGrid = S.showGrid && S.grid * view.z >= 5;
  setA(gridRect, 'display', showGrid ? null : 'none');
  setA(gridPat, 'width', S.grid); setA(gridPat, 'height', S.grid);
  setA(gridPath, 'd', 'M' + S.grid + ' 0H0V' + S.grid);
  setA(gridPath, 'stroke-width', rnd(1 / view.z, 4));
  setA(outside, 'd', 'M-100000 -100000H100000V100000H-100000Z M0 0V' + doc.h + 'H' + doc.w + 'V0Z');
}
function applyView() {
  setA(world, 'transform', 'translate(' + rnd(view.x, 2) + ' ' + rnd(view.y, 2) + ') scale(' + rnd(view.z, 5) + ')');
  $('#z-label').textContent = Math.round(view.z * 100) + '%';
  drawArtboard(); syncObjects(); drawOverlay();
  if (te) tePlace();   // text being typed in place follows the canvas (09f-text-edit.js)
}
function stageSize() { const r = stage.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top }; }
function fit() {
  const s = stageSize(), pad = s.w < 600 ? 20 : 48;
  const z = clamp(Math.min((s.w - pad * 2) / doc.w, (s.h - pad * 2) / doc.h), 0.05, 4);
  view.z = z; view.x = (s.w - doc.w * z) / 2; view.y = (s.h - doc.h * z) / 2;
  applyView();
}
function zoomAt(f, sx, sy) {
  const nz = clamp(view.z * f, 0.05, 32), k = nz / view.z;
  view.x = sx - (sx - view.x) * k; view.y = sy - (sy - view.y) * k; view.z = nz;
  applyView();
}
function zoomCenter(f) { userView = true; const s = stageSize(); zoomAt(f, s.w / 2, s.h / 2); }

/* ---------- selection overlay ---------- */
// What's drawn over the canvas: whatever the current drag or tool draws, or else the selection
// handles (see TOOLS and DRAGS in 09-pointer-interaction.js)
function drawOverlay() {
  ov.textContent = '';
  showPathBar();
  const k = drag && DRAGS[drag.type], t = tool();
  if (k && k.overlay && k.overlay()) return;
  if (t.overlay && t.overlay()) return;
  const z = view.z;
  if (drag && drag.type === 'marquee' && drag.cur) {
    const r = drag.rect();
    ov.appendChild(svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'ov-line ov-fill' }));
  }
  const sel = selObjs().filter(o => !isHidden(o));
  if (!sel.length || (drag && drag.type === 'marquee')) return;
  const hs = 9 / z;
  if (sel.length === 1) {
    const o = sel[0], ends = lineEnds(o);
    if (ends) {   // a straight line: a handle on each end instead of a box
      ov.appendChild(svgEl('line', { x1: ends[0][0], y1: ends[0][1], x2: ends[1][0], y2: ends[1][1], class: 'ov-line ov-dash' }));
      ends.forEach((q, i) => ov.appendChild(svgEl('circle', { cx: q[0], cy: q[1], r: 6 / z, class: 'handle', 'data-h': 'p' + (i + 1) })));
    } else {
      const c = centerOf(o);
      const g = svgEl('g', { transform: o.rot ? 'rotate(' + o.rot + ' ' + c.x + ' ' + c.y + ')' : null });
      g.appendChild(svgEl('rect', { x: o.x, y: o.y, width: o.w, height: o.h, class: 'ov-line' }));
      // The whole of the left and right edge of a text wrapped to a box changes its width, not only the square handle (drawn first, so the handles on top win)
      if (o.kind === 'text' && o.bw > 0) ['w', 'e'].forEach(n => g.appendChild(svgEl('rect', { x: o.x + (n === 'e' ? o.w : 0) - 6 / z, y: o.y, width: 12 / z, height: o.h, class: 'handle edge', 'data-h': n })));
      const names = o.kind === 'text' && o.bw > 0 ? ['nw', 'ne', 'e', 'se', 'sw', 'w'] : keepsRatio(o) ? ['nw', 'ne', 'se', 'sw'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      names.forEach(n => {
        const hx = n.includes('e') ? 1 : n.includes('w') ? 0 : 0.5, hy = n.includes('s') ? 1 : n.includes('n') ? 0 : 0.5;
        g.appendChild(svgEl('rect', { x: o.x + hx * o.w - hs / 2, y: o.y + hy * o.h - hs / 2, width: hs, height: hs, rx: hs * 0.18, class: 'handle', 'data-h': n }));
      });
      const ry = o.y - 26 / z;
      g.appendChild(svgEl('line', { x1: c.x, y1: o.y, x2: c.x, y2: ry, class: 'ov-line' }));
      g.appendChild(svgEl('circle', { cx: c.x, cy: ry, r: 5.5 / z, class: 'handle rot', 'data-h': 'rot' }));
      ov.appendChild(g);
    }
  } else {
    // Several objects, or a group. A whole group gets one solid box; a loose selection shows each
    // object's outline and a dashed box around them all. Either way the corners scale everything
    // together and the round handle turns it (see "moving several objects as one").
    const units = selectionUnits(doc, new Set(sel.map(o => o.id))), oneGroup = units.length === 1 && !!units[0].g;
    if (!oneGroup) sel.forEach(o => {
      const ends = lineEnds(o);
      if (ends) { ov.appendChild(svgEl('line', { x1: ends[0][0], y1: ends[0][1], x2: ends[1][0], y2: ends[1][1], class: 'ov-line' })); return; }
      const c = centerOf(o);
      ov.appendChild(svgEl('rect', { x: o.x, y: o.y, width: o.w, height: o.h, class: 'ov-line', transform: o.rot ? 'rotate(' + o.rot + ' ' + c.x + ' ' + c.y + ')' : null }));
    });
    const turning = drag && drag.type === 'mrotate';
    const u = turning ? drag.u0 : unionBox(sel), cx = u.x + u.w / 2, cy = u.y + u.h / 2;
    const g = svgEl('g', { transform: turning && drag.theta ? 'rotate(' + rnd(drag.theta, 3) + ' ' + cx + ' ' + cy + ')' : null });
    g.appendChild(svgEl('rect', { x: u.x, y: u.y, width: u.w, height: u.h, class: oneGroup ? 'ov-line' : 'ov-line ov-dash' }));
    if (!sel.some(isLocked)) {
      [['mnw', 0, 0], ['mne', 1, 0], ['mse', 1, 1], ['msw', 0, 1]].forEach(([n, hx, hy]) =>
        g.appendChild(svgEl('rect', { x: u.x + hx * u.w - hs / 2, y: u.y + hy * u.h - hs / 2, width: hs, height: hs, rx: hs * 0.18, class: 'handle', 'data-h': n })));
      const ry = u.y - 26 / z;
      g.appendChild(svgEl('line', { x1: cx, y1: u.y, x2: cx, y2: ry, class: 'ov-line' }));
      g.appendChild(svgEl('circle', { cx, cy: ry, r: 5.5 / z, class: 'handle rot', 'data-h': 'mrot' }));
    }
    ov.appendChild(g);
  }
}

