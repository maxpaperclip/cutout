/* =====================================================================
   Perspective
   Tilts the selection as if it were seen from an angle. The selection's bounding box is
   carried onto a four-corner shape that the student drags, and every point of every selected
   shape is moved by that same projective transform (a homography). SVG has no perspective,
   so shapes and text are rewritten as plain paths (lines just move their two ends), and photos
   are resampled into a new picture (see "photo warping"). Photos inside shapes are tilted with
   the shape. Nothing new is stored in the drawing beyond ordinary paths and photos, so saving,
   opening and exporting are unchanged.
   A "session" remembers the shapes as they were when tilting began, so dragging a corner
   again re-tilts the originals instead of stacking one tilt on another.
   ===================================================================== */
const PERSP_TOL = 0.04;   // how far (page units) a redrawn curve may stray from the true one

// The transform that carries four points (src) onto four others (dst), as 8 numbers.
// Points are centered and scaled first, so big or far-off shapes stay accurate.
function homography(src, dst) {
  let cx = 0, cy = 0;
  src.forEach(p => { cx += p[0] / 4; cy += p[1] / 4; });
  const k = Math.max(1, Math.hypot(src[2][0] - src[0][0], src[2][1] - src[0][1]) / 2);
  const nm = p => [(p[0] - cx) / k, (p[1] - cy) / k];
  const s = src.map(nm), t = dst.map(nm), A = [], b = [];
  for (let i = 0; i < 4; i++) {
    A.push([s[i][0], s[i][1], 1, 0, 0, 0, -t[i][0] * s[i][0], -t[i][0] * s[i][1]]); b.push(t[i][0]);
    A.push([0, 0, 0, s[i][0], s[i][1], 1, -t[i][1] * s[i][0], -t[i][1] * s[i][1]]); b.push(t[i][1]);
  }
  for (let i = 0; i < 8; i++) {
    let p = i;
    for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    if (Math.abs(A[p][i]) < 1e-12) return null;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < 8; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < 8; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const h = new Array(8);
  for (let i = 7; i >= 0; i--) { let v = b[i]; for (let c = i + 1; c < 8; c++) v -= A[i][c] * h[c]; h[i] = v / A[i][i]; }
  return h.every(Number.isFinite) ? { h, cx, cy, k } : null;
}
function hApply(H, x, y) {
  const X = (x - H.cx) / H.k, Y = (y - H.cy) / H.k, h = H.h, w = h[6] * X + h[7] * Y + 1;
  return [H.k * (h[0] * X + h[1] * Y + h[2]) / w + H.cx, H.k * (h[3] * X + h[4] * Y + h[5]) / w + H.cy];
}
// A straight line stays straight under perspective, but a curve does not stay a cubic curve.
// So carry the four control points across, check the middle of the result against the true
// curve, and split the piece in two wherever it strays.
function projCubic(H, P, out, depth) {
  const q = P.map(p => hApply(H, p[0], p[1]));
  if (depth < 7) {
    for (const t of [0.25, 0.5, 0.75]) {
      const m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t;
      const px = a * q[0][0] + b * q[1][0] + c * q[2][0] + d * q[3][0], py = a * q[0][1] + b * q[1][1] + c * q[2][1] + d * q[3][1];
      const tr = hApply(H, a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1]);
      if (Math.hypot(px - tr[0], py - tr[1]) > PERSP_TOL) {
        const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
        const ab = mid(P[0], P[1]), bc = mid(P[1], P[2]), cd = mid(P[2], P[3]), abc = mid(ab, bc), bcd = mid(bc, cd), mm = mid(abc, bcd);
        projCubic(H, [P[0], ab, abc, mm], out, depth + 1);
        projCubic(H, [mm, bcd, cd, P[3]], out, depth + 1);
        return;
      }
    }
  }
  out.push(q);
}

/* ---------- photo warping ----------
   A photo cannot be tilted by SVG, so it is resampled: every pixel of the new picture asks
   "which point of the old photo do I show?" (an inverse mapping through the tilt), and that point
   is read from a mip-mapped copy of the photo so that the shrunken far side is averaged rather
   than aliased. Everything is 8-bit premultiplied RGBA, so memory stays small and semi-transparent
   edges blend correctly. 3x3 matrices are plain arrays of 9 numbers, row by row. */
const PHOTO_LOD_BIAS = 0;   // <0 sharper but risks shimmer, >0 softer

const mul3 = (A, B) => {
  const R = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return R;
};
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (!det || !Number.isFinite(det)) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
// The homography object from homography() as a plain 3x3 in the original coordinates
function hMat(H) {
  const h = H.h, k = H.k;
  return mul3([k, 0, H.cx, 0, k, H.cy, 0, 0, 1], mul3([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1], [1 / k, 0, -H.cx / k, 0, 1 / k, -H.cy / k, 0, 0, 1]));
}
// Premultiply and build the mip chain (each level averages 2x2 texels of the one before)
function texFromRGBA(w, h, rgba) {
  const d0 = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, n = w * h * 4; i < n; i += 4) {
    const a = rgba[i + 3];
    if (a === 255) { d0[i] = rgba[i]; d0[i + 1] = rgba[i + 1]; d0[i + 2] = rgba[i + 2]; d0[i + 3] = 255; }
    else { const k = a / 255; d0[i] = rgba[i] * k + 0.5; d0[i + 1] = rgba[i + 1] * k + 0.5; d0[i + 2] = rgba[i + 2] * k + 0.5; d0[i + 3] = a; }
  }
  const mips = [{ w, h, d: d0 }];
  for (let s = mips[0]; s.w > 1 || s.h > 1; s = mips[mips.length - 1]) {
    const nw = (s.w + 1) >> 1, nh = (s.h + 1) >> 1, d = new Uint8ClampedArray(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      const y0 = 2 * y, y1 = Math.min(s.h - 1, y0 + 1);
      for (let x = 0; x < nw; x++) {
        const x0 = 2 * x, x1 = Math.min(s.w - 1, x0 + 1), i00 = (y0 * s.w + x0) * 4, i10 = (y0 * s.w + x1) * 4, i01 = (y1 * s.w + x0) * 4, i11 = (y1 * s.w + x1) * 4, o = (y * nw + x) * 4;
        for (let c = 0; c < 4; c++) d[o + c] = (s.d[i00 + c] + s.d[i10 + c] + s.d[i01 + c] + s.d[i11 + c] + 2) >> 2;
      }
    }
    mips.push({ w: nw, h: nh, d });
  }
  return { w, h, mips };
}
// Fill rows y0..y1-1 of `out` (RGBA, outW wide). M carries output pixel coordinates to photo pixel
// coordinates. poly is the convex outline of the photo in output pixels (used for a clean, anti-aliased
// edge, and to stay away from the horizon); orient is +1 or -1 for the way round the outline runs.
function warpRows(tex, M, poly, orient, out, outW, y0, y1) {
  const E = poly.map((p, i) => { const q = poly[(i + 1) % poly.length], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1; return [-dy / L * orient, dx / L * orient, p[0], p[1]]; });
  const ne = E.length, maxLv = tex.mips.length - 1, tw = tex.w, th = tex.h;
  const m0 = M[0], m1 = M[1], m2 = M[2], m3 = M[3], m4 = M[4], m5 = M[5], m6 = M[6], m7 = M[7], m8 = M[8];
  for (let y = y0; y < y1; y++) {
    const py = y + 0.5;
    for (let x = 0; x < outW; x++) {
      const px = x + 0.5;
      let cov = 1;
      for (let k = 0; k < ne; k++) { const e = E[k], sd = (px - e[2]) * e[0] + (py - e[3]) * e[1] + 0.5; if (sd < cov) cov = sd; }
      if (cov <= 0) continue;
      const w = m6 * px + m7 * py + m8, iw = 1 / w, nu = m0 * px + m1 * py + m2, nv = m3 * px + m4 * py + m5, u = nu * iw, v = nv * iw;
      // how many photo pixels one output pixel spans (largest direction), for the mip level and the source-edge fade
      const dux = (m0 - u * m6) * iw, dvx = (m3 - v * m6) * iw, duy = (m1 - u * m7) * iw, dvy = (m4 - v * m7) * iw;
      const sx = dux * dux + dvx * dvx, sy = duy * duy + dvy * dvy, s = Math.sqrt(sx > sy ? sx : sy);
      const se = Math.min(u, tw - u, v, th - v) / (s || 1) + 0.5;
      if (se <= 0) continue;
      if (se < cov) cov = se;
      let lod = s > 1 ? Math.log2(s) + PHOTO_LOD_BIAS : 0;
      if (lod < 0) lod = 0; else if (lod > maxLv) lod = maxLv;
      const l0 = lod | 0, f = lod - l0, l1 = l0 < maxLv ? l0 + 1 : l0;
      let r = 0, g = 0, b = 0, a = 0;
      for (let pass = 0; pass < 2; pass++) {
        const lv = pass ? l1 : l0, wt = pass ? f : 1 - f;
        if (wt <= 0) continue;
        const m = tex.mips[lv], sc = 1 / (1 << lv);
        let fu = u * sc - 0.5, fv = v * sc - 0.5;
        if (fu < 0) fu = 0; else if (fu > m.w - 1) fu = m.w - 1;
        if (fv < 0) fv = 0; else if (fv > m.h - 1) fv = m.h - 1;
        const ix = fu | 0, iy = fv | 0, ax = fu - ix, ay = fv - iy, jx = ix + 1 < m.w ? ix + 1 : ix, jy = iy + 1 < m.h ? iy + 1 : iy, d = m.d;
        const i00 = (iy * m.w + ix) * 4, i10 = (iy * m.w + jx) * 4, i01 = (jy * m.w + ix) * 4, i11 = (jy * m.w + jx) * 4;
        const w00 = (1 - ax) * (1 - ay) * wt, w10 = ax * (1 - ay) * wt, w01 = (1 - ax) * ay * wt, w11 = ax * ay * wt;
        r += d[i00] * w00 + d[i10] * w10 + d[i01] * w01 + d[i11] * w11;
        g += d[i00 + 1] * w00 + d[i10 + 1] * w10 + d[i01 + 1] * w01 + d[i11 + 1] * w11;
        b += d[i00 + 2] * w00 + d[i10 + 2] * w10 + d[i01 + 2] * w01 + d[i11 + 2] * w11;
        a += d[i00 + 3] * w00 + d[i10 + 3] * w10 + d[i01 + 3] * w01 + d[i11 + 3] * w11;
      }
      if (a <= 0) continue;
      const o = (y * outW + x) * 4, k = 255 / a;
      out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k; out[o + 3] = a * cov;
    }
  }
}

const PHOTO_PREVIEW_EDGE = 300;   // longest side, in pixels, of the quick preview drawn while dragging
const PHOTO_MAX_PIXELS = 1.3e6;   // a tilted photo is kept at about this size (PNG files of photos get big)
const texCache = new Map(), texPending = new Map();
// Decode a photo once into a mip-mapped texture, kept for the next few tilts
function photoTexture(rec) {
  const hit = texCache.get(rec.id);
  if (hit) return Promise.resolve(hit);
  let p = texPending.get(rec.id);
  if (!p) {
    p = (async () => {
      const img = await loadPicture(rec.dataUrl);
      const cv = document.createElement('canvas'); cv.width = rec.w; cv.height = rec.h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, rec.w, rec.h);
      const px = ctx.getImageData(0, 0, rec.w, rec.h).data;
      cv.width = cv.height = 0;
      const tex = texFromRGBA(rec.w, rec.h, px);
      texCache.set(rec.id, tex);
      if (texCache.size > 3) texCache.delete(texCache.keys().next().value);
      return tex;
    })();
    texPending.set(rec.id, p);
    const done = () => texPending.delete(rec.id);
    p.then(done, done);
  }
  return p;
}

/* ---------- the session ---------- */
const geomSnap = o => ({ kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0, fx: !!o.fx, fy: !!o.fy, d: o.d, img: o.img, pic: o.pic ? o.pic.id + ',' + o.pic.dx + ',' + o.pic.dy + ',' + o.pic.s : '' });
const sameGeom = (a, b) => { for (const k in a) if (a[k] !== b[k]) return false; return true; };
const PERSP_HINT = 'Drag a corner to tilt the selection. Hold Shift to move two corners together.';

function perspEligible() {
  const sel = selObjs();
  if (!sel.length) return { why: 'Select a shape, some text, a photo or a few objects, then drag a corner to tilt them.' };
  if (sel.some(isLocked)) return { why: 'Unlock the selected objects first.' };
  if (sel.some(o => hasPixels(o) && !images.has(o.img))) return { why: 'That photo is not available any more.' };
  if (sel.some(o => hasPic(o) && !picCovers(o) && o.fill && o.fill !== 'none')) return { why: 'The photo has to fill the shape before it can be tilted. Choose Fit photo first.' };
  if (sel.some(hasGrad)) return { why: 'Shapes with a gradient fill can\u2019t be tilted yet. Change the fill to Solid first.' };
  return { objs: sel };
}
// (boxToWorld, box coordinates to page coordinates, is in 04c-path-edit.js)
// Where a photo sits on the page, as a 3x3 matrix from photo pixels to page coordinates
function perspPhotoInfo(o) {
  const masked = !hasPixels(o), rec = images.get(masked ? o.pic.id : o.img);
  const g = masked ? picGeom(o) : { x: 0, y: 0, w: o.w, h: o.h };
  const p0 = boxToWorld(o, 0, 0), p1 = boxToWorld(o, 1, 0), p2 = boxToWorld(o, 0, 1);
  const A = [p1[0] - p0[0], p1[1] - p0[1], p2[0] - p0[0], p2[1] - p0[1], p0[0], p0[1]];
  const sx = g.w / rec.w, sy = g.h / rec.h;
  return {
    rec: rec.id, W: rec.w, H: rec.h, mask: masked, name: rec.name,
    dens: rec.w / g.w,   // photo pixels per page unit
    P: [A[0] * sx, A[2] * sy, A[0] * g.x + A[2] * g.y + A[4], A[1] * sx, A[3] * sy, A[1] * g.x + A[3] * g.y + A[5], 0, 0, 1]
  };
}
// Remember each object as it is now, as page-coordinate curve points ready to be moved
function perspBuild(objs) {
  let x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const items = objs.map(o => {
    const it = { id: o.id, o0: JSON.parse(JSON.stringify(o)), last: geomSnap(o) };
    const ends = lineEnds(o);   // a straight line stays straight when tilted, so just its ends move
    if (ends) { it.line = ends[0].concat(ends[1]); ends.forEach(q => grow(q[0], q[1])); return it; }
    if (hasPixels(o) || hasPic(o)) it.photo = perspPhotoInfo(o);
    if (hasPixels(o)) {
      const P = it.photo.P;
      [[0, 0], [it.photo.W, 0], [it.photo.W, it.photo.H], [0, it.photo.H]].forEach(c => grow(P[0] * c[0] + P[1] * c[1] + P[2], P[3] * c[0] + P[4] * c[1] + P[5]));
      return it;
    }
    const item = worldPaper(o);
    it.contours = (item.children || [item]).filter(c => c.segments.length > 1).map(c => ({
      closed: c.closed, S: c.segments.map(s => ({ p: [s.point.x, s.point.y], i: [s.handleIn.x, s.handleIn.y], o: [s.handleOut.x, s.handleOut.y] }))
    }));
    if (it.contours.length) { const b = item.bounds; grow(b.x, b.y); grow(b.x + b.width, b.y + b.height); }
    return it;
  });
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  const src = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const P = { items, src, quad: src.map(p => p.slice()), states: [] };
  perspRecord(P);
  // photos need their pixels read once before they can be tilted
  items.forEach(it => {
    if (!it.photo) return;
    it.tex = texCache.get(it.photo.rec) || null;
    if (!it.tex) photoTexture(images.get(it.photo.rec)).then(t => { it.tex = t; if (psn === P) drawOverlay(); }, () => { it.texFail = true; if (psn === P) drawOverlay(); });
  });
  return P;
}
const perspReady = P => P.items.every(it => !it.photo || it.tex);
// Every tilt the session has produced (shape state + corner positions), so that Undo and Redo
// land back inside the session with the handles on the real corners, and Reset can still
// return to the shapes as they were when tilting began.
function perspRecord(P) {
  P.states.push({ lasts: P.items.map(it => it.last), quad: P.quad.map(q => q.slice()) });
  if (P.states.length > 200) P.states.splice(1, 1);   // keep the starting state
}
// The current session for the selection. It carries on while the shapes are as the session left
// them, or are back at a state it produced earlier (undo / redo). Anything else (moving, resizing,
// a different selection) starts a fresh session from the shapes as they are now.
// Returns { P } or { why }.
function perspState() {
  const el = perspEligible();
  if (!el.objs) { psn = null; return { why: el.why }; }
  if (psn && psn.items.length === el.objs.length && psn.items.every((it, k) => it.id === el.objs[k].id)) {
    const cur = el.objs.map(geomSnap);
    if (psn.items.every((it, k) => sameGeom(it.last, cur[k]))) return { P: psn };
    for (let n = psn.states.length - 1; n >= 0; n--) {
      const st = psn.states[n];
      if (st.lasts.every((l, k) => sameGeom(l, cur[k]))) {
        psn.items.forEach((it, k) => { it.last = cur[k]; });
        psn.quad = st.quad.map(q => q.slice());
        return { P: psn };
      }
    }
  }
  const P = perspBuild(el.objs);
  psn = P;
  return P ? { P } : { why: 'That is too flat to tilt. Select it together with another shape.' };
}

/* ---------- applying a tilt ---------- */
function perspCompute(P, quad) {
  const H = homography(P.src, quad);
  if (!H) return null;
  const out = [];
  for (const it of P.items) {
    if (it.line) {
      const a = hApply(H, it.line[0], it.line[1]), b = hApply(H, it.line[2], it.line[3]);
      out.push({ it, line: [a[0], a[1], b[0], b[1]] });
      continue;
    }
    if (!it.contours) { out.push({ it, photoOnly: true }); continue; }
    const contours = [];
    it.contours.forEach(c => {
      const S = c.S, n = S.length, last = c.closed ? n : n - 1, cub = [];
      for (let k = 0; k < last; k++) {
        const a = S[k], b = S[(k + 1) % n];
        projCubic(H, [a.p, [a.p[0] + a.o[0], a.p[1] + a.o[1]], [b.p[0] + b.i[0], b.p[1] + b.i[1]], b.p], cub, 0);
      }
      if (cub.length) contours.push({ closed: c.closed, cub });
    });
    out.push({ it, contours });
  }
  const finite = v => Number.isFinite(v);
  const ok = out.every(r => r.line ? r.line.every(finite) : r.photoOnly || r.contours.every(c => c.cub.every(q => q.every(pt => finite(pt[0]) && finite(pt[1])))));
  return ok ? out : null;
}
// Exact bounding box of a set of cubic curves: their end points plus the points where they
// turn around (roots of the derivative). Much cheaper than re-reading the path text.
function perspBounds(contours) {
  let x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  contours.forEach(c => c.cub.forEach(q => {
    add(q[0][0], q[0][1]); add(q[3][0], q[3][1]);
    for (let ax = 0; ax < 2; ax++) {
      const d0 = 3 * (q[1][ax] - q[0][ax]), d1 = 3 * (q[2][ax] - q[1][ax]), d2 = 3 * (q[3][ax] - q[2][ax]);
      const A = d0 - 2 * d1 + d2, B = 2 * (d1 - d0), C = d0, roots = [];
      if (Math.abs(A) < 1e-12) { if (Math.abs(B) > 1e-12) roots.push(-C / B); }
      else { const disc = B * B - 4 * A * C; if (disc >= 0) { const sq = Math.sqrt(disc); roots.push((-B + sq) / (2 * A), (-B - sq) / (2 * A)); } }
      roots.forEach(t => {
        if (t <= 0 || t >= 1) return;
        const m = 1 - t, a = m * m * m, b = 3 * m * m * t, cc = 3 * m * t * t, d = t * t * t;
        add(a * q[0][0] + b * q[1][0] + cc * q[2][0] + d * q[3][0], a * q[0][1] + b * q[1][1] + cc * q[2][1] + d * q[3][1]);
      });
    }
  }));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
function perspWrite(results) {
  results.forEach(r => {
    const o = byId(r.it.id); if (!o || r.photoOnly) return;
    if (r.line) {
      setLineEnds(o, { x: rnd(r.line[0], 3), y: rnd(r.line[1], 3) }, { x: rnd(r.line[2], 3), y: rnd(r.line[3], 3) });
    } else {
      if (!r.contours.length) return;
      const bb = perspBounds(r.contours), f = v => rnd(v, 2);
      const w = Math.max(rnd(bb.width, 3), 0.01), h = Math.max(rnd(bb.height, 3), 0.01);
      const d = r.contours.map(c => 'M' + f(c.cub[0][0][0] - bb.x) + ' ' + f(c.cub[0][0][1] - bb.y) +
        c.cub.map(q => 'C' + f(q[1][0] - bb.x) + ' ' + f(q[1][1] - bb.y) + ' ' + f(q[2][0] - bb.x) + ' ' + f(q[2][1] - bb.y) + ' ' + f(q[3][0] - bb.x) + ' ' + f(q[3][1] - bb.y)).join('') + (c.closed ? 'Z' : '')).join('');
      delete o.fx; delete o.fy;
      if (!r.it.photo) delete o.pic;
      toPlainPath(o, d, w, h); o.rot = 0; o.x = rnd(bb.x, 3); o.y = rnd(bb.y, 3);
      if (!o.name) { o.name = r.it.o0.kind === 'text' ? labelOf(r.it.o0) : 'Shape'; r.it.auto = o.name; }
    }
  });
}
function perspApply(P) {
  const r = perspCompute(P, P.quad);
  if (!r) return false;
  perspWrite(r);
  perspPhotosPreview(P);
  P.items.forEach(it => { const o = byId(it.id); if (o) it.last = geomSnap(o); });
  return true;
}
const boundsOf = pts => { let x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12; pts.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
// Work out how one photo is to be redrawn for the tilt in P.quad: the page area its new picture
// covers, how many pixels that is, and the map from each new pixel back to a point of the old photo.
function perspPhotoPlan(P, it, preview) {
  const o = byId(it.id), ph = it.photo, quad = P.quad, Hf = homography(P.src, quad), Hb = homography(quad, P.src), Pi = inv3(ph.P);
  if (!o || !Hf || !Hb || !Pi) return null;
  let R, polyW;
  if (!ph.mask) {
    polyW = [[0, 0], [ph.W, 0], [ph.W, ph.H], [0, ph.H]].map(c => hApply(Hf, ph.P[0] * c[0] + ph.P[1] * c[1] + ph.P[2], ph.P[3] * c[0] + ph.P[4] * c[1] + ph.P[5]));
    R = boundsOf(polyW);
  } else {              // a photo in a shape: only the part showing through the tilted shape is kept
    R = { x: o.x - 1, y: o.y - 1, w: o.w + 2, h: o.h + 2 };
    polyW = quad;
  }
  if (!(R.w > 0 && R.h > 0)) return null;
  let rho = preview ? PHOTO_PREVIEW_EDGE / Math.max(R.w, R.h) : Math.sqrt(PHOTO_MAX_PIXELS / (R.w * R.h));
  rho = Math.max(0.02, Math.min(rho, ph.dens, LIMITS.edge / Math.max(R.w, R.h)));
  const w = Math.max(1, Math.ceil(R.w * rho - 0.01)), h = Math.max(1, Math.ceil(R.h * rho - 0.01));   // (ignoring the last hundredth of a pixel keeps rounding noise from adding a sliver column)
  const M = mul3(Pi, mul3(hMat(Hb), [1 / rho, 0, R.x, 0, 1 / rho, R.y, 0, 0, 1]));
  const poly = polyW.map(p => [(p[0] - R.x) * rho, (p[1] - R.y) * rho]);
  const area = poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0);
  return { it, R: { x: R.x, y: R.y, w: w / rho, h: h / rho }, w, h, M, poly, orient: area >= 0 ? 1 : -1 };
}
// Make the object show a new picture (of `pxW` pixels across) that covers plan.R
function perspSetPhoto(o, plan, recId, pxW) {
  if (hasPixels(o)) {
    o.img = recId; o.x = rnd(plan.R.x, 3); o.y = rnd(plan.R.y, 3); o.w = rnd(plan.R.w, 3); o.h = rnd(plan.R.h, 3); o.rot = 0;
    delete o.fx; delete o.fy;
  } else {
    o.pic = { id: recId, dx: rnd(plan.R.x + plan.R.w / 2 - (o.x + o.w / 2), 3), dy: rnd(plan.R.y + plan.R.h / 2 - (o.y + o.h / 2), 3), s: rnd(plan.R.w / pxW, 6) };
  }
}
// While dragging: a small, quick version of each photo
function perspPhotosPreview(P) {
  P.items.forEach(it => {
    if (!it.photo || !it.tex) return;
    const plan = perspPhotoPlan(P, it, true); if (!plan) return;
    const out = new Uint8ClampedArray(plan.w * plan.h * 4);
    warpRows(it.tex, plan.M, plan.poly, plan.orient, out, plan.w, 0, plan.h);
    const cv = document.createElement('canvas'); cv.width = plan.w; cv.height = plan.h;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(plan.w, plan.h);
    img.data.set(out); ctx.putImageData(img, 0, 0);
    const key = 'ptmp' + it.id;
    images.set(key, { id: key, blob: null, dataUrl: cv.toDataURL('image/png'), w: plan.w, h: plan.h, mime: 'image/png', bytes: 0, name: it.photo.name, stored: true });
    cv.width = cv.height = 0;
    perspSetPhoto(byId(it.id), plan, key, plan.w);
  });
}
// Full quality, in slices so the page can keep painting
async function warpAsync(tex, plan, out, progress) {
  let y = 0, t0 = performance.now();
  while (y < plan.h) {
    const y1 = Math.min(plan.h, y + 8);
    warpRows(tex, plan.M, plan.poly, plan.orient, out, plan.w, y, y1);
    y = y1;
    if (performance.now() - t0 > 30) { progress(y / plan.h); await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); }
  }
}
// PNG keeps the transparent corners. If the file comes out bigger than photos are allowed to be,
// squeeze the picture a little at a time, as importing does.
async function encodeWarped(out, w, h) {
  let cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h);
  img.data.set(out); ctx.putImageData(img, 0, 0);
  let blob = await canvasBlob(cv, 'image/png'), sw = w, sh = h;
  for (let tries = 0; blob && blob.size > LIMITS.storedBytes && tries < 3; tries++) {
    sw = Math.max(1, Math.round(sw * 0.75)); sh = Math.max(1, Math.round(sh * 0.75));
    const c2 = document.createElement('canvas'); c2.width = sw; c2.height = sh;
    const x2 = c2.getContext('2d'); x2.imageSmoothingQuality = 'high'; x2.drawImage(cv, 0, 0, sw, sh);
    cv.width = cv.height = 0; cv = c2;
    blob = await canvasBlob(cv, 'image/png');
  }
  cv.width = cv.height = 0;
  if (!blob) throw new Error('The picture could not be saved.');
  return { blob, dataUrl: await readDataUrl(blob), w: sw, h: sh };
}
// When a drag ends and the selection includes photos: redraw them at full quality, then commit
let psnBusy = false;
async function perspBake(P) {
  psnBusy = true; $('#busy').hidden = false;
  const hint = $('#persp-hint'), photos = P.items.filter(it => it.photo);
  try {
    const jobs = [];
    for (let k = 0; k < photos.length; k++) {
      const it = photos[k], plan = perspPhotoPlan(P, it, false);
      if (!plan) throw new Error('This tilt cannot be drawn.');
      const out = new Uint8ClampedArray(plan.w * plan.h * 4);
      await warpAsync(it.tex, plan, out, f => { if (hint) hint.textContent = 'Making the photo sharp\u2026 ' + Math.round((k + f) / photos.length * 100) + '%'; });
      jobs.push({ it, plan, enc: await encodeWarped(out, plan.w, plan.h) });
    }
    if (psn !== P) throw new Error('The selection changed.');
    jobs.forEach(j => {
      const rec = { id: uid(), blob: j.enc.blob, dataUrl: j.enc.dataUrl, w: j.enc.w, h: j.enc.h, mime: 'image/png', bytes: j.enc.blob.size, name: j.it.photo.name, stored: false };
      images.set(rec.id, rec); images.delete('ptmp' + j.it.id);
      perspSetPhoto(byId(j.it.id), j.plan, rec.id, rec.w);
    });
    P.items.forEach(it => { const o = byId(it.id); if (o) it.last = geomSnap(o); });
    perspRecord(P);
    commit();
  } catch (err) {
    console.error(err);
    revertUncommitted(); psn = null;
    toast('That photo could not be tilted. Try a gentler tilt or a smaller photo.');
  } finally {
    psnBusy = false; $('#busy').hidden = true; refreshAll();
  }
}
// A drag has ended: shapes and lines are already final, photos are still previews
function perspRelease(d) {
  const P = d.P;
  if (psn !== P) { commit(); return; }
  if (!P.items.some(it => it.photo)) { perspRecord(P); commit(); return; }
  if (!P.quad.some((q, k) => q[0] !== d.q0[k][0] || q[1] !== d.q0[k][1])) { revertUncommitted(); return; }
  perspBake(P);
}
// A tilt only makes sense while the four corners stay in order and form a convex shape,
// with no corner squashed nearly flat. Otherwise points would swing through the horizon.
function perspValid(q) {
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1], lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 2 || lv < 2 || (ux * vy - uy * vx) / (lu * lv) < 0.02) return false;
  }
  return true;
}
const lerpQuad = (a, b, t) => a.map((p, k) => [p[0] + (b[k][0] - p[0]) * t, p[1] + (b[k][1] - p[1]) * t]);
const PARTNER_H = [1, 0, 3, 2], PARTNER_V = [3, 2, 1, 0];   // the corner beside / above-below each corner

/* ---------- pointer handling ---------- */
function perspDown(e, p) {
  const h = e.target.closest && e.target.closest('[data-h]');
  if (h && /^q[0-3]$/.test(h.dataset.h)) {
    const st = perspState();
    if (st.P && perspReady(st.P)) drag = { type: 'persp', P: st.P, i: +h.dataset.h[1], q0: st.P.quad.map(q => q.slice()), sx: e.clientX, sy: e.clientY, dir: null };
    return;
  }
  // otherwise this tool just picks what to tilt
  const multi = e.shiftKey || e.metaKey || e.ctrlKey;
  const g = e.target.closest && e.target.closest('[data-id]');
  const o = g ? byId(+g.dataset.id) : null;
  if (o && !isLocked(o) && !isHidden(o)) {
    const unit = clickUnit(doc, o).filter(x => !isLocked(x) && !isHidden(x)).map(x => x.id);   // a whole group, as on the canvas
    if (multi && S.sel.has(o.id)) unit.forEach(id => S.sel.delete(id)); else if (multi) unit.forEach(id => S.sel.add(id)); else S.sel = new Set(unit);
  } else if (!multi) S.sel = new Set();
  refreshAll();
}
function updatePersp(p, e) {
  const d = drag, P = d.P;
  if (psn !== P) return;                    // the shapes changed under us (undo, pinch...): ignore
  const t = snapPt(p), i = d.i, cand = P.quad.map(q => q.slice());
  cand[i] = [t.x, t.y];
  if (e.shiftKey) {
    // move the neighbouring corner in mirror image, so the near side stays level or upright
    const dx = t.x - d.q0[i][0], dy = t.y - d.q0[i][1];
    if (!d.dir && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.dir = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    if (d.dir === 'h') { const j = PARTNER_H[i]; cand[j] = [d.q0[j][0] - dx, d.q0[j][1] + dy]; }
    else if (d.dir === 'v') { const j = PARTNER_V[i]; cand[j] = [d.q0[j][0] + dx, d.q0[j][1] - dy]; }
  } else d.dir = null;
  let q = cand;
  if (!perspValid(q)) {                     // stop at the last good position instead of letting it fold
    let lo = 0, hi = 1;
    for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (perspValid(lerpQuad(P.quad, cand, mid))) lo = mid; else hi = mid; }
    q = lerpQuad(P.quad, cand, lo);
  }
  if (q.every((pt, k) => pt[0] === P.quad[k][0] && pt[1] === P.quad[k][1])) return;
  const before = P.quad;
  P.quad = q;
  if (perspApply(P)) render(); else P.quad = before;
}

/* ---------- overlay, bar, reset ---------- */
function updatePerspBar(st) {
  const hint = $('#persp-hint'), reset = $('#persp-reset');
  if (!hint) return;
  hint.textContent = st.P ? (st.P.items.some(it => it.texFail) ? 'That photo could not be opened.' : perspReady(st.P) ? PERSP_HINT : 'Getting the photo ready\u2026') : st.why;
  reset.disabled = !(st.P && st.P.quad.some((q, k) => q[0] !== st.P.src[k][0] || q[1] !== st.P.src[k][1]));
}
function perspOverlay() {
  ov.textContent = '';
  const st = perspState();
  updatePerspBar(st);
  if (!st.P || !perspReady(st.P)) return;
  const P = st.P, q = P.quad, z = view.z, H = homography(P.src, q);
  const x0 = P.src[0][0], y0 = P.src[0][1], x1 = P.src[2][0], y1 = P.src[2][1];
  if (H) [1 / 3, 2 / 3].forEach(f => {       // guide lines: the original box in thirds, carried through the same tilt
    const yy = y0 + (y1 - y0) * f, xx = x0 + (x1 - x0) * f;
    [[x0, yy, x1, yy], [xx, y0, xx, y1]].forEach(l => {
      const a = hApply(H, l[0], l[1]), b = hApply(H, l[2], l[3]);
      ov.appendChild(svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'ov-line ov-dash', opacity: 0.45 }));
    });
  });
  ov.appendChild(svgEl('path', { d: 'M' + q.map(pt => rnd(pt[0], 3) + ' ' + rnd(pt[1], 3)).join('L') + 'Z', class: 'ov-line' }));
  q.forEach((pt, i) => {
    ov.appendChild(svgEl('circle', { cx: pt[0], cy: pt[1], r: 16 / z, class: 'q-hit', 'data-h': 'q' + i }));
    ov.appendChild(svgEl('circle', { cx: pt[0], cy: pt[1], r: 6.5 / z, class: 'handle', 'data-h': 'q' + i }));
  });
}
// Put the selection back the way it was when tilting began (text is editable text again)
const PERSP_KEEP = STYLE_KEYS.concat(['hidden', 'locked']);   // changes made while tilted are kept
function perspReset() {
  const P = perspState().P; if (!P) return;
  P.items.forEach(it => {
    const i = doc.objects.findIndex(x => x.id === it.id); if (i < 0) return;
    const cur = doc.objects[i], back = JSON.parse(JSON.stringify(it.o0));
    copyKeys(cur, back, PERSP_KEEP);
    if (cur.name !== it.auto) back.name = cur.name;
    doc.objects[i] = back; it.last = geomSnap(back); images.delete('ptmp' + it.id);
  });
  P.quad = P.src.map(q => q.slice());
  perspRecord(P);
  commit();
}


/* ---------- registering the Perspective tool ---------- */
TOOLS.perspective = {
  key: 'd', cursor: 'select',
  down: (e, p) => perspDown(e, p),
  keys(e) {
    if (e.key !== 'Enter' || e.target.closest('button')) return false;
    e.preventDefault(); setTool('select'); refreshAll(); return true;
  },
  overlay() { perspOverlay(); return true; },
  enter() { $('#persp-bar').hidden = false; },
  leave() { psn = null; $('#persp-bar').hidden = true; }
};
DRAGS.persp = { move: (p, e) => updatePersp(p, e), end: d => perspRelease(d) };
