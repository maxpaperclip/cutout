/* =====================================================================
   Editing commands
   ===================================================================== */
function deleteSelected() {
  if (!S.sel.size) return;
  doc.objects = doc.objects.filter(o => !S.sel.has(o.id));
  S.sel = new Set(); commit();
}
// Copies go just above the topmost original, so a copy of something inside a group lands inside it.
// Whole groups in the selection are copied as groups (see copyWithGroups).
function duplicateSelected() {
  const sel = selObjs(); if (!sel.length) return;
  const c = copyWithGroups(doc, sel, groupsFilledBy(doc, sel), true);
  c.objects.forEach(o => { moveBy(o, 16, 16); o.name = o.name ? o.name + ' copy' : ''; });
  const at = Math.max(...sel.map(o => doc.objects.indexOf(o))) + 1;
  doc.groups.push(...c.groups); doc.objects.splice(at, 0, ...c.objects);
  S.sel = new Set(c.objects.map(o => o.id)); commit();
}
function copySelected() {
  const sel = selObjs(); if (!sel.length) return;
  S.clip = JSON.stringify({ objects: sel, groups: groupsFilledBy(doc, sel) }); S.pasteN = 0; toast('Copied.');
}
// Pasted copies go on top, keeping any whole groups that were copied
function pasteClipboard() {
  if (!S.clip) return;
  S.pasteN++;
  const clip = JSON.parse(S.clip), objs = Array.isArray(clip) ? clip : clip.objects, groups = Array.isArray(clip) ? [] : clip.groups;
  const c = copyWithGroups(doc, objs, groups, false);
  c.objects.forEach(o => moveBy(o, 16 * S.pasteN, 16 * S.pasteN));
  doc.groups.push(...c.groups); doc.objects.push(...c.objects);
  S.sel = new Set(c.objects.map(o => o.id)); commit();
}
// Put the selection in a group (Ctrl+G), or take selected groups apart (Ctrl+Shift+G)
function groupSelected() {
  const r = groupObjects(doc, S.sel);
  if (r.why) { toast(r.why); return; }
  commit();
}
function ungroupSelected() {
  if (!ungroupObjects(doc, S.sel)) { toast('Select a group to take it apart.'); return; }
  commit();
}
// Whole groups move as one, and a single member moves only within its own group
function orderSelected(how) {
  if (!S.sel.size) return;
  reorderUnits(doc, S.sel, how);
  commit();
}
function alignSelected(mode) {
  const sel = selObjs().filter(o => !isLocked(o)); if (!sel.length) return;
  // A whole group lines up as one piece, keeping its own layout
  const units = selectionUnits(doc, new Set(sel.map(o => o.id))).map(nodeLeaves);
  const ref = units.length > 1 ? unionBox(sel) : { x: 0, y: 0, w: doc.w, h: doc.h };
  units.forEach(list => {
    const b = unionBox(list); let dx = 0, dy = 0;
    if (mode === 'l') dx = ref.x - b.x;
    if (mode === 'ch') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
    if (mode === 'r') dx = ref.x + ref.w - (b.x + b.w);
    if (mode === 't') dy = ref.y - b.y;
    if (mode === 'cv') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
    if (mode === 'b') dy = ref.y + ref.h - (b.y + b.h);
    list.forEach(o => moveBy(o, dx, dy));
  });
  commit();
}
// Mirror each selected object about the center of the whole selection
// (for a single object that is its own center, so it flips in place).
function mirrorSelected(axis) {
  const sel = selObjs(); if (!sel.length) return;
  const u = unionBox(sel), ux = u.x + u.w / 2, uy = u.y + u.h / 2;
  sel.forEach(o => {
    const c = centerOf(o);
    if (axis === 'h') { o.x = 2 * ux - c.x - o.w / 2; o.fx = !o.fx; } else { o.y = 2 * uy - c.y - o.h / 2; o.fy = !o.fy; }
    o.rot = rnd(normDeg(-o.rot), 2);   // a mirror image turns the other way
  });
  commit();
}
function nudge(dx, dy) { const sel = selObjs(); if (!sel.length) return; sel.forEach(o => moveBy(o, dx, dy)); commit(); }
function selectAll() { S.sel = new Set(doc.objects.filter(o => !isHidden(o) && !isLocked(o)).map(o => o.id)); refreshAll(); }

