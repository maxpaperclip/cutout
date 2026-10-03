/* =====================================================================
   SVG import
   Brings an SVG file in as ordinary, editable Cutout objects: shapes become paths, groups become
   groups, gradients become Cutout gradients, text becomes Cutout text (in Cutout's default font)
   and embedded pictures become photos. Three steps:
     1. svgSafeParse(text): read the file and make it safe. Students may download SVGs from anywhere,
        so scripts, event handlers, embedded web content, animation and anything that would fetch
        from the internet are removed before anything else happens. <style> rules are copied onto
        the shapes they apply to, because paper.js only reads colors written on the shapes.
     2. paper.js reads the cleaned SVG into its own items (with shapes expanded to paths).
     3. svgConvert(): walks those items and makes Cutout objects. This step uses only paper.js,
        so it can be tested without a browser.
   Embedded pictures are swapped for marker paths before paper.js reads the file (it loads
   pictures later, so their size isn't known in time). The marker's four corners say exactly
   where the picture goes, even when it is turned or flipped.
   ===================================================================== */
const SVG_LIMITS = { fileBytes: 5 * 1024 * 1024, objects: 3000 };
const SVG_IMG_MARK = '__cutimg_';

/* ---------- 1. reading the file safely ---------- */
// Presentation properties worth copying from <style> rules and style="" onto the shapes
const SVG_PROPS = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linejoin', 'stroke-linecap',
  'stroke-dasharray', 'stroke-miterlimit', 'opacity', 'display', 'visibility', 'stop-color', 'stop-opacity', 'clip-rule',
  'font-size', 'font-family', 'font-weight', 'text-anchor', 'mix-blend-mode'];
const SAFE_PICTURE = /^data:image\/(png|jpe?g|webp|gif);base64,/i;
function svgSafeParse(text) {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (!svg || svg.localName !== 'svg' || parsed.getElementsByTagName('parsererror').length) throw new Error('That file is not a readable SVG drawing.');
  // Remove anything that could run code, show web content, animate, or reach the internet
  svg.querySelectorAll('script, foreignObject, iframe, object, embed, audio, video, canvas, animate, animateMotion, animateTransform, animateColor, set, discard, handler, listener')
    .forEach(e => e.remove());
  const localRef = v => /^\s*#/.test(v);
  const cleanUrls = v => v.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, u) => localRef(u) ? m : 'none');
  svg.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(a => {
      const n = a.name.toLowerCase(), v = a.value;
      if (n.startsWith('on')) el.removeAttribute(a.name);
      else if (n === 'href' || n === 'xlink:href' || n === 'src') {
        const picture = el.localName === 'image' && SAFE_PICTURE.test(v);
        if (!localRef(v) && !picture) el.removeAttribute(a.name);
      } else if (/url\(/i.test(v)) el.setAttribute(a.name, cleanUrls(v));
    });
  });
  // paper.js only follows the older xlink:href form of links (to reused symbols, gradients that build on others...)
  svg.querySelectorAll('[href]').forEach(el => { if (!el.hasAttribute('xlink:href')) el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', el.getAttribute('href')); });
  svg.querySelectorAll('a').forEach(a => { while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a); a.remove(); });   // keep what's inside links, not the link
  // Copy <style> rules and style="" onto the shapes as plain attributes (later rules win, style="" wins over rules)
  const fromRules = new Map();
  svg.querySelectorAll('style').forEach(st => {
    const css = cleanUrls((st.textContent || '').replace(/@import[^;]*;?/gi, ''));
    st.remove();
    if (typeof CSSStyleSheet === 'undefined') return;
    let sheet;
    try { sheet = new CSSStyleSheet(); sheet.replaceSync(css); } catch (e) { return; }
    Array.from(sheet.cssRules).forEach(rule => {
      if (!rule.selectorText || !rule.style) return;
      let els; try { els = svg.querySelectorAll(rule.selectorText); } catch (e) { return; }
      els.forEach(el => {
        const m = fromRules.get(el) || {};
        SVG_PROPS.forEach(p => { const v = rule.style.getPropertyValue(p); if (v) m[p] = v; });
        fromRules.set(el, m);
      });
    });
  });
  svg.querySelectorAll('*').forEach(el => {
    const props = Object.assign({}, fromRules.get(el));
    const inline = el.getAttribute('style');
    if (inline) inline.split(';').forEach(decl => {
      const i = decl.indexOf(':'); if (i < 0) return;
      const p = decl.slice(0, i).trim().toLowerCase(), v = decl.slice(i + 1).replace(/!important/i, '').trim();
      if (SVG_PROPS.indexOf(p) >= 0 && v) props[p] = v;
    });
    Object.keys(props).forEach(p => el.setAttribute(p, cleanUrls(props[p])));
  });
  svgExpandUses(parsed, svg);
  svgScaleOutlines(svg);
  // Swap each embedded picture for a marker path (see the top of this section)
  const pictures = [];
  svg.querySelectorAll('image').forEach(im => {
    const href = im.getAttribute('href') || im.getAttribute('xlink:href') || '';
    const num = a => { const v = parseFloat(im.getAttribute(a)); return Number.isFinite(v) ? v : 0; };
    const x = num('x'), y = num('y'), w = num('width'), h = num('height');
    if (!SAFE_PICTURE.test(href) || w <= 0 || h <= 0) { im.remove(); return; }
    const mark = parsed.createElementNS('http://www.w3.org/2000/svg', 'path');
    mark.setAttribute('id', SVG_IMG_MARK + pictures.length);
    mark.setAttribute('d', 'M' + x + ' ' + y + 'L' + (x + w) + ' ' + y + 'L' + (x + w) + ' ' + (y + h) + 'L' + x + ' ' + (y + h) + 'Z');
    mark.setAttribute('fill', '#000');
    ['transform', 'opacity', 'display', 'visibility', 'mix-blend-mode'].forEach(a => { if (im.hasAttribute(a)) mark.setAttribute(a, im.getAttribute(a)); });
    pictures.push({ href, fit: (im.getAttribute('preserveAspectRatio') || '').trim() !== 'none' });
    im.replaceWith(mark);
  });
  return { svg, pictures };
}

// Replace each <use> (a reused shape or symbol) with a real copy, sized and placed the way the SVG
// asks. paper.js places reused symbols but doesn't scale them. A cap on how much can be copied
// stops a file from multiplying itself into millions of shapes.
function svgExpandUses(parsed, svg) {
  const NS = 'http://www.w3.org/2000/svg', KEEP_ID = /^(linearGradient|radialGradient|clipPath|mask|pattern)$/;
  const num = (el, a, def) => { const v = parseFloat(el.getAttribute(a)); return Number.isFinite(v) ? v : def; };
  let budget = SVG_LIMITS.objects;
  for (let pass = 0; pass < 6; pass++) {   // copies can contain more <use>s; a few rounds covers real files
    const uses = Array.from(svg.getElementsByTagName('use'));
    if (!uses.length) break;
    uses.forEach(u => {
      const ref = (u.getAttribute('href') || u.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '').trim();
      const target = ref[0] === '#' ? parsed.getElementById(ref.slice(1)) : null;
      const size = target ? target.getElementsByTagName('*').length + 1 : 0;
      if (!target || target === u || target.contains(u) || size > budget) { u.remove(); return; }
      budget -= size;
      const g = parsed.createElementNS(NS, 'g');
      // what the <use> sets (colors, opacity...) passes down to the copy, as it does in SVG
      SVG_PROPS.forEach(a => { if (u.hasAttribute(a)) g.setAttribute(a, u.getAttribute(a)); });
      let xf = (u.getAttribute('transform') || '') + ' translate(' + num(u, 'x', 0) + ' ' + num(u, 'y', 0) + ')';
      const kids = target.localName === 'symbol' ? Array.from(target.childNodes) : [target];
      if (target.localName === 'symbol') {
        const vb = (target.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
          const W = num(u, 'width', num(target, 'width', vb[2])), H = num(u, 'height', num(target, 'height', vb[3]));
          const par = (target.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim();
          let sx = W / vb[2], sy = H / vb[3], tx = 0, ty = 0;
          if (par.indexOf('none') !== 0) {
            const s = /slice/.test(par) ? Math.max(sx, sy) : Math.min(sx, sy);
            sx = sy = s;
            const fx = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5, fy = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
            tx = (W - vb[2] * s) * fx; ty = (H - vb[3] * s) * fy;
          }
          xf += ' translate(' + tx + ' ' + ty + ') scale(' + sx + ' ' + sy + ') translate(' + (-vb[0]) + ' ' + (-vb[1]) + ')';
        }
      }
      kids.forEach(k => {
        const c = k.cloneNode(true);
        if (c.nodeType === 1) [c, ...c.getElementsByTagName('*')].forEach(e => { if (!KEEP_ID.test(e.localName)) e.removeAttribute('id'); });
        g.appendChild(c);
      });
      g.setAttribute('transform', xf.trim());
      u.replaceWith(g);
    });
  }
  Array.from(svg.getElementsByTagName('use')).forEach(u => u.remove());
  Array.from(svg.getElementsByTagName('symbol')).forEach(sy => sy.remove());   // only ever shown through <use>
}

// In SVG, an outline grows when its shape is scaled up (by its own transform, the groups around it, or
// the file's viewBox). paper.js builds those scales into the shapes' points but leaves outline widths
// as written, so write each shape's scaled outline width onto it before paper.js reads the file.
const SVG_SHAPES = /^(path|rect|circle|ellipse|line|polyline|polygon)$/;
function svgScaleOutlines(svg) {
  const len = v => { const m = /^\s*([\d.]+(?:e[-+]?\d+)?)\s*(px)?\s*$/i.exec(v || ''); return m ? parseFloat(m[1]) : null; };
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number), W = len(svg.getAttribute('width')), H = len(svg.getAttribute('height'));
  const rootScale = vb.length === 4 && vb[2] > 0 && vb[3] > 0 && W && H ? Math.sqrt((W / vb[2]) * (H / vb[3])) : 1;
  (function walk(el, scale, width, fixed) {
    let k = 1;
    try { const t = el.transform && el.transform.baseVal && el.transform.baseVal.consolidate(); if (t) k = Math.sqrt(Math.abs(t.matrix.a * t.matrix.d - t.matrix.b * t.matrix.c)); } catch (e) { /* no transform */ }
    const sc = scale * (k || 1), own = len(el.getAttribute('stroke-width')), sw = own !== null ? own : width;
    const keep = fixed || el.getAttribute('vector-effect') === 'non-scaling-stroke';
    if (SVG_SHAPES.test(el.localName) && !keep && Math.abs(sc - 1) > 1e-9) el.setAttribute('stroke-width', String(sw * sc));
    Array.from(el.children).forEach(c => walk(c, sc, sw, keep));
  })(svg, rootScale, 1, false);
}

// The Cutout font closest to an SVG font: serif, monospace or sans serif, regular or bold
function svgFontFor(family, weight) {
  const f = String(family || '').toLowerCase(), bold = /bold|[6-9]00/.test(String(weight || ''));
  const key = /mono|courier|consol/.test(f) ? 'mono' : /serif/.test(f) && !/sans/.test(f) || /times|georgia|garamond/.test(f) ? (bold ? 'lora-b' : 'lora') : (bold ? 'inter-xb' : 'inter');
  return typeof fonts !== 'undefined' && fonts[key] ? key : DEFAULT_FONT;
}

/* ---------- 3. turning paper.js items into Cutout objects ---------- */
const svgScaleOf = m => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
function svgColor(c) {
  if (!c) return null;
  if (c.gradient) { const s = c.gradient.stops[0]; return s ? { hex: normHex(s.color.toCSS(true)) || '#000000', a: s.color.alpha } : null; }
  return { hex: normHex(c.toCSS(true)) || '#000000', a: c.alpha };
}
// A paper.js gradient color, as a Cutout gradient laid out over the shape's box (b, page coordinates)
function svgGradient(c, m, b) {
  if (!c || !c.gradient || c.gradient.stops.length < 2) return null;
  const n = c.gradient.stops.length, w = Math.max(b.width, 1e-6), h = Math.max(b.height, 1e-6);
  let stops = c.gradient.stops.map((s, i) => ({ at: s.offset !== undefined && s.offset !== null ? s.offset : i / (n - 1), c: normHex(s.color.toCSS(true)) || '#000000', a: s.color.alpha }));
  if (stops.length > GRAD_MAX_STOPS) {   // keep the ends and evenly spaced colors in between
    const k = (stops.length - 1) / (GRAD_MAX_STOPS - 1);
    stops = Array.from({ length: GRAD_MAX_STOPS }, (_, i) => stops[Math.round(i * k)]);
  }
  const P = p => { const q = m.transform(p); return { x: (q.x - b.x) / w, y: (q.y - b.y) / h, px: q.x, py: q.y }; };
  const o = P(c.origin), d = P(c.destination);
  let g;
  if (c.gradient.radial) {
    // Cutout's radial gradients stretch with the box, so a circle on a non-square box is approximate
    const R = Math.hypot(d.px - o.px, d.py - o.py);
    g = { type: 'radial', stops, cx: o.x, cy: o.y, r: R / Math.sqrt(w * h) };
    if (c.highlight) { const f = P(c.highlight); g.fx = f.x; g.fy = f.y; }
  } else g = { type: 'linear', stops, x1: o.x, y1: o.y, x2: d.x, y2: d.y };
  return sanitizeGrad(g);
}
const svgNameOf = item => (item.name && item.name.indexOf(SVG_IMG_MARK) !== 0 ? String(item.name).slice(0, 60) : '');
// Walk the paper.js items and make Cutout objects in the current drawing's id space.
// Returns { objects, groups, pictures: [{ n, corners }], counts }.
function svgConvert(root) {
  const out = { objects: [], groups: [], pictures: [], counts: { shapes: 0, text: 0, skipped: 0, clipped: 0, tooMany: false } };
  const room = () => out.objects.length + out.pictures.length < SVG_LIMITS.objects || (out.counts.tooMany = true, false);
  const put = (o, parent) => { if (parent !== null) o.parent = parent; out.objects.push(o); };
  const visibleKids = it => (it.children || []).filter(c => c.visible && !c.clipMask);
  // A plain shape (circle, rect...) as a path, placed the same way
  const asPath = it => { const p = it.toPath(false); return { src: p, mx: p.matrix }; };
  // blend: the blend mode passed down from a group; Cutout groups have no blend of their own
  function walk(item, acc, parent, op, clip, depth, blend) {
    if (!item.visible || !room()) return;
    const m = acc.appended(item.matrix), opacity = op * (item.opacity === undefined ? 1 : item.opacity), cls = item.className;
    const bl = item.blendMode && item.blendMode !== 'normal' && BLEND_IDS.indexOf(item.blendMode) >= 0 ? item.blendMode : blend;
    const mark = o => { if (bl) o.blend = bl; return o; };
    if (cls === 'Group' || cls === 'Layer') {
      let c = clip;
      if (item.clipped && item.children.length) {
        const cm = item.children.find(k => k.clipMask);
        const shape = cm && (cm.className === 'Shape' ? asPath(cm) : cm.pathData !== undefined ? { src: cm, mx: cm.matrix } : null);
        if (shape) {
          const cp = new paper.CompoundPath({ pathData: shape.src.pathData, insert: false }); cp.transform(m.appended(shape.mx));
          c = clip ? clip.intersect(cp, { insert: false }) : cp;
        }
      }
      const kids = visibleKids(item);
      let gid = parent;
      if (kids.length > 1 && cls === 'Group' && depth > 0) {   // the file itself, or a group of one thing, adds nothing
        const g = { id: doc.nextId++, name: svgNameOf(item), parent, hidden: false, locked: false };
        out.groups.push(g); gid = g.id;
      }
      kids.forEach(k => walk(k, m, gid, opacity, c, depth + 1, bl));
    } else if (cls === 'SymbolItem') {
      if (item.definition && item.definition.item) walk(item.definition.item, m, parent, opacity, clip, depth + 1, bl);
    } else if (cls === 'Path' || cls === 'CompoundPath' || cls === 'Shape') {
      if (item.name && item.name.indexOf(SVG_IMG_MARK) === 0) { pictureMark(item, m, parent, bl); return; }
      // toPath() may already have placed the shape, so its own matrix is used rather than the Shape's
      const o = cls === 'Shape' ? (sp => svgShape(sp.src, acc.appended(sp.mx), opacity, clip, item))(asPath(item)) : svgShape(item, m, opacity, clip, item);
      if (o) { put(mark(o), parent); out.counts.shapes++; }
    } else if (cls === 'PointText') {
      const o = svgText(item, m, opacity);
      if (o) { put(mark(o), parent); out.counts.text++; }
    } else out.counts.skipped++;
  }
  function pictureMark(item, m, parent, blend) {
    const segs = item.segments || (item.children && item.children[0] && item.children[0].segments) || [];
    if (segs.length < 4) return;
    const corners = [0, 1, 3].map(i => { const p = m.transform(segs[i].point); return { x: p.x, y: p.y }; });
    out.pictures.push({ n: +item.name.slice(SVG_IMG_MARK.length), corners, parent, blend });
  }
  function svgShape(src, m, opacity, clip, styled) {
    let path = new paper.CompoundPath({ pathData: src.pathData, insert: false });
    if (!path.children.length && !path.segments) return null;
    if (styled.fillRule === 'evenodd') { try { path.reorient(false, true); } catch (e) { /* leave as is */ } }   // holes stay holes
    path.transform(m);
    const parts = path.children && path.children.length ? path.children : [path];
    const straight = parts.some(q => !q.closed) && parts.reduce((n, q) => n + q.segments.length, 0) <= 2;
    // SVG gives every shape a black fill unless told otherwise; on a straight line it can't be seen, so drop it
    const fill = straight ? null : svgColor(styled.fillColor), stroke = styled.strokeWidth > 0 ? svgColor(styled.strokeColor) : null;
    if (!fill && !stroke) return null;   // nothing to see
    if (clip) {
      const cb = clip.bounds, pb = path.bounds;
      if (!(pb.x >= cb.x && pb.y >= cb.y && pb.x + pb.width <= cb.x + cb.width && pb.y + pb.height <= cb.y + cb.height)) {
        try { path = clip.intersect(path, { insert: false }); out.counts.clipped++; } catch (e) { /* keep it whole */ }
      }
    }
    const b = path.bounds;
    if (b.width < 0.01 && b.height < 0.01) return null;
    const grad = fill && styled.fillColor.gradient ? svgGradient(styled.fillColor, m, b) : null;
    path.translate(new paper.Point(-b.x, -b.y));
    const d = path.pathData; if (!d) return null;
    const w = Math.max(b.width, 0.01), h = Math.max(b.height, 0.01);
    const sw = stroke ? (styled.strokeScaling === false ? styled.strokeWidth : styled.strokeWidth * svgScaleOf(m)) : 0;
    const dashes = styled.dashArray && styled.dashArray.length ? styled.dashArray : null;
    const o = newShape('path', {
      name: svgNameOf(styled), x: b.x, y: b.y, w, h, nat: { d, w, h },
      fill: fill ? fill.hex : 'none', stroke: stroke ? stroke.hex : 'none', sw: rnd(sw, 3),
      opacity: rnd(clamp(opacity * (fill ? fill.a : stroke.a), 0, 1), 3),
      join: ['miter', 'round', 'bevel'].indexOf(styled.strokeJoin) >= 0 ? styled.strokeJoin : 'miter',
      dash: !dashes ? 'solid' : dashes[0] <= Math.max(sw, 1) * 0.5 ? 'dotted' : 'dashed'
    });
    if (stroke && CAPS.indexOf(styled.strokeCap) >= 0) o.cap = styled.strokeCap;   // SVG's own ends (flat unless it says otherwise)
    if (grad) { o.grad = grad; o.fill = grad.stops[0].c; }
    return o;
  }
  function svgText(item, m, opacity) {
    const content = String(item.content || '').replace(/\s+$/, '');
    if (!content.trim()) return null;
    const fill = svgColor(item.fillColor);
    const size = clamp((item.fontSize || 16) * svgScaleOf(m), 4, 1200);
    const align = item.justification === 'center' ? 'center' : item.justification === 'right' ? 'right' : 'left';
    const o = newShape('text', { text: content.slice(0, 5000), size: rnd(size, 2), align, font: svgFontFor(item.fontFamily, item.fontWeight),
      fill: fill ? fill.hex : '#000000', stroke: 'none', opacity: rnd(clamp(opacity * (fill ? fill.a : 1), 0, 1), 3) });
    // Put Cutout's text box where the SVG's first baseline was, then turn it the same way
    const font = fontOf(o.font), k = o.size / font.unitsPerEm, asc = font.ascender * k, desc = -font.descender * k;
    const baseline = (o.lh * o.size - (asc + desc)) / 2 + asc;
    // the text's own origin is its first baseline; its matrix already holds the position
    const p = m.transform(new paper.Point(0, 0)), rot = normDeg(Math.atan2(m.b, m.a) / D2R);
    const x = p.x - (align === 'center' ? o.w / 2 : align === 'right' ? o.w : 0), y = p.y - baseline;
    const c = rotPt(x + o.w / 2, y + o.h / 2, p.x, p.y, rot);
    o.x = c.x - o.w / 2; o.y = c.y - o.h / 2; o.rot = rnd(rot, 2);
    return o;
  }
  walk(root, new paper.Matrix(), null, 1, null, 0, null);
  return out;
}
// A picture's box from its marker's corners: top-left, top-right and bottom-left, in page coordinates
function svgPictureBox(corners) {
  const [tl, tr, bl] = corners;
  const w = Math.hypot(tr.x - tl.x, tr.y - tl.y), h = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const flip = (tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x) < 0;
  return { cx: (tr.x + bl.x) / 2, cy: (tr.y + bl.y) / 2, w, h, rot: normDeg(Math.atan2(tr.y - tl.y, tr.x - tl.x) / D2R), flip };
}

// An embedded picture (a base64 data: URL, already checked by SAFE_PICTURE) as a file
function svgPictureBlob(url) {
  const i = url.indexOf(','), type = url.slice(5, url.indexOf(';')).toLowerCase().replace('image/jpg', 'image/jpeg');
  const bin = atob(url.slice(i + 1).replace(/\s+/g, '')), u = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
  return new Blob([u], { type });
}

/* ---------- putting it on the page ---------- */
async function importSVGFile(file) {
  const name = baseName(file.name), label = '“' + name + '”';
  if (file.size > SVG_LIMITS.fileBytes) throw new Error(label + ' is ' + fmtMB(file.size) + ' MB. SVG files can be up to ' + fmtMB(SVG_LIMITS.fileBytes) + ' MB.');
  const { svg, pictures } = svgSafeParse(await file.text());
  let root;
  try { root = paper.project.importSVG(svg, { insert: false, expandShapes: true }); } catch (e) { console.error(e); throw new Error(label + ' could not be read. It may use SVG features Cutout doesn’t know.'); }
  if (!root) throw new Error(label + ' could not be read.');
  const before = { next: doc.nextId };
  let res;
  try { res = svgConvert(root); } catch (e) { console.error(e); doc.nextId = before.next; throw new Error(label + ' could not be converted. It may use SVG features Cutout doesn’t know.'); }
  const boxes = res.pictures.map(p => svgPictureBox(p.corners));
  if (!res.objects.length && !boxes.length) { doc.nextId = before.next; throw new Error(label + ' has nothing in it that Cutout can show.'); }
  // Fit it on the page if it is too big, and center it
  const all = res.objects.map(aabb).concat(boxes.map(b => ({ x: b.cx - b.w / 2, y: b.cy - b.h / 2, w: b.w, h: b.h })));
  const u = unionBox(all.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, rot: 0 })));
  const k = Math.min(1, (doc.w * 0.9) / Math.max(u.w, 1e-6), (doc.h * 0.9) / Math.max(u.h, 1e-6));
  const dx = (doc.w - u.w * k) / 2 - u.x * k, dy = (doc.h - u.h * k) / 2 - u.y * k;
  res.objects.forEach(o => { if (k !== 1) scaleAbout(o, JSON.parse(JSON.stringify(o)), 0, 0, k); moveBy(o, dx, dy); });
  // Everything goes in one group named after the file
  let top = null;
  if (res.objects.length + boxes.length > 1) {
    top = { id: doc.nextId++, name, parent: null, hidden: false, locked: false };
    res.groups.forEach(g => { if (g.parent === null) g.parent = top.id; });
    res.objects.forEach(o => { if (o.parent === undefined) o.parent = top.id; });
    res.groups.unshift(top);
  }
  doc.groups.push(...res.groups);
  doc.objects.push(...res.objects);
  // Embedded pictures go through the same checks and shrinking as imported photos
  let photoProblem = null;
  const picIds = [];
  for (let i = 0; i < res.pictures.length; i++) {
    const p = res.pictures[i], info = pictures[p.n], b = boxes[i];
    if (!info) continue;
    if (docPhotoIds(doc).size >= LIMITS.photos) { photoProblem = 'Some pictures in the file were left out because this drawing has the most photos it can hold.'; break; }
    let rec;
    try {
      const raw = svgPictureBlob(info.href);   // decoded here; nothing is fetched
      rec = await processPhoto(new File([raw], name + ' picture.' + raw.type.split('/')[1], { type: raw.type }));
    } catch (e) { photoProblem = 'A picture in the file could not be added.'; continue; }
    images.set(rec.id, rec);
    if (DB.ok) { try { await idbPut('images', { id: rec.id, blob: rec.blob, w: rec.w, h: rec.h, mime: rec.mime, name: rec.name }); rec.stored = true; } catch (e) { /* retried when autosaving */ } }
    let w = b.w * k, h = b.h * k;
    if (info.fit) { const s = Math.min(w / rec.w, h / rec.h); w = rec.w * s; h = rec.h * s; }   // SVG pictures keep their shape unless told not to
    const cx = b.cx * k + dx, cy = b.cy * k + dy;
    const im = makeImage(rec, { x: cx - w / 2, y: cy - h / 2, w, h, rot: b.rot });
    if (b.flip) im.fy = true;
    if (p.blend) im.blend = p.blend;
    const parent = p.parent !== null ? p.parent : top ? top.id : null;
    if (parent !== null) im.parent = parent;
    doc.objects.push(im); picIds.push(im.id);
  }
  normalizeGroups(doc);
  return { ids: res.objects.map(o => o.id).concat(picIds), top, counts: res.counts, pictures: picIds.length, scaled: k < 1, photoProblem };
}
