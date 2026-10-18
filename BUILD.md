# Building FriendShaped

FriendShaped ships two ways, both made by the same build:

- **`FriendShaped.html`**, the *lite single file*: one self-contained HTML file with a small set of fonts built in. No server,
  no install, works from a USB stick or an email attachment.
- **`site/`**, the *hosted site* (built in `dist/site/`, and committed to the repo like `FriendShaped.html`): `index.html` plus a `fonts/` folder with every font. The page only carries the
  fonts it needs to start; any other font is fetched from `fonts/` the first time it is used, and the browser keeps it.
  To publish it, upload the contents of `site/` to any static web host (GitHub Pages, Netlify, Cloudflare Pages, a
  school server). Nothing else from the repo is needed. It has to be opened from a web address: a page opened straight
  from disk can't fetch the fonts folder, and says so.
  `site/` also holds `version.json` (the version just built) and `_headers` (no-cache rules that Netlify and Cloudflare Pages read;
  GitHub Pages ignores it). A page that is already open compares its own version with `version.json` (`checkForUpdate` in
  `12-ui-chrome.js`) and offers a Reload button when they differ, because a browser or host may keep showing the page it has stored
  and a plain refresh can bring the old version back. A page opened from disk does not check.

You don't hand-edit either: instead you edit smaller files under `src/`, and a build script glues them together.

## Layout

```
src/
  index.html         Page shell (head, toolbar, panels, dialogs — all the HTML)
  styles.css          All CSS, extracted as-is from the old <style> block
  fonts/
    manifest.json     Maps font keys (e.g. "inter-xb") to their .woff file: every weight and italic is its own entry
    faces.json        Each family's other weights and italics (made by scripts/fetch-fonts.js)
    builds.json       Which fonts each build has built into its HTML: "core" (the hosted page) and "lite" (the single file)
    *.woff            The actual fonts, as real binary files (Latin subsets, except noto-sans-sc)
    licenses/         Each font's license text; CREDITS.md is the table of fonts and licenses
  js/
    manifest.json     Load order for the files below (order matters — see note)
    00-preamble.js     Library check + paper.js setup
    01-helpers.js       $ / $$ / small DOM helpers
    02-icons.js
    03-fonts-runtime.js The font list (families, their weights and italics), fetching fonts on demand, fonts parsed on first use (opentype.js), browser font loading
    04-document-model.js
    04b-groups.js       Groups (folders in Layers): kept beside the flat object list
    04c-path-edit.js    Path geometry shared by the Pen tool and point editing
    04d-erase.js        Erase masks: how an erased object is described and drawn (no DOM, unit tested)
    04e-eyedrop.js      Eyedropper sums: which part of the page to draw, and the average color of 1 or 3 x 3 pixels (no DOM, unit tested)
    04f-text-layout.js  Text layout with a position for every character (the caret, the selection and clicks all come from it, and the outlines are drawn from it), wrapping a text to a box width (o.bw: area text, as opposed to point text, which has none), justifying it, hyphenating it, indenting paragraphs and hanging quotes and hyphens into the margin (o.align 'justify', o.hyph, o.indent, o.noind1, o.pspace, o.hang) (no DOM, unit tested)
    04g-text-runs.js    Letters of one text in their own color, size or font (o.runs, run-length list): edits, styles applied to a selection, cleaning of loaded runs (no DOM, unit tested)
    04h-hyphen-data.js  English hyphenation patterns (generated from TeX's hyph-en-us.tex; carries the copyright notice that must stay with it). Data only
    04h-hyphenation.js  hyphenPoints(word): where an English word may be broken (Liang's method; no DOM, unit tested)
    04i-text-wrap.js    Text wrapping around shapes: the outline of every shape with o.wrap, cut to a row, gives the stretches of a text box that are free (wrapObstacles, wrapFree; textLayout fills them in turn); wrapSyncAll lays texts out again when a shape moves (paper.js only, unit tested)
    04j-grids.js        Column grid and baseline grid (doc.grids): defaults, sanitizing, where the lines are, their SVG paths, and snapping to them (no DOM, unit tested)
    04k-text-paragraphs.js  Settings of single paragraphs of a text (o.paras): kept in step with typing, saved and opened, and the bars that show which paragraphs a selection touches (no DOM, unit tested)
    05-svg-export.js
    06-boolean-ops.js   unite / subtract / intersect / exclude (paper.js)
    06b-break-apart.js  Break apart: a text becomes one plain shape per letter, in a new folder (no DOM, unit tested)
    07-history-autosave.js  Undo/redo + IndexedDB persistence
    08-rendering.js
    09-pointer-interaction.js
    09b-pen.js          Pen tool and point editing (pointer and keyboard handling)
    09c-eraser.js       Eraser tool: pointer handling, the brush bar, and baking strokes into a mask or layer picture
    09d-brush.js        Brush tool and paint layers (shares its strokes, bar and baking with the Eraser)
    09e-eyedropper.js   Eyedropper: a temporary tool started from a color field, reads the whole drawing as it looks on screen
    09f-text-edit.js    Typing text in place: an invisible text box takes the keyboard, and the caret and selection are drawn from the text's own layout
    10-perspective.js
    11-editing-commands.js
    12-ui-chrome.js
    13-inspector.js
    13b-font-picker.js  The categorized font picker, the Style menu and Bold / Italic buttons, and fonts added from the computer ("Yours")
    14-layers-tab.js
    15-page-tab.js
    16-export.js
    17-projects.js
    18-photos.js
    18b-svg-import.js   Imports SVG files as editable shapes (made safe first: only listed SVG elements and attributes are kept)
    19-ui-wiring.js
    20-boot.js
build.js              The build script (plain Node; needs `npm ci` for the two libraries it builds in)
scripts/copy-to-root.js   Copies a finished build to the repo root for release
scripts/fetch-fonts.js    Downloads the library's Latin fonts and licenses from Fontsource (npm)
scripts/verify-fonts.js   Checks every font and license is byte-identical to its Fontsource package (npm)
scripts/subset-cjk.py     Cuts Noto Sans SC down to the common Chinese characters (needs fonttools)
dist/                  Build output: FriendShaped.html and site/ (gitignored; `npm run release` copies them to the repo root)
FriendShaped.html, site/     The committed release: the lite single file, and the hosted page with its fonts/ folder
```

The split follows the section comments that were already in the old file
(`/* ===== Boolean operations ===== */` and so on) — nothing was reorganized
or rewritten, just cut along lines that were already there. If you diff the
concatenation of `src/js/*.js` against the old single file, they're
byte-for-byte identical.

### Why the JS files aren't ES modules

The files under `src/js/` all share one global scope on purpose. `build.js` concatenates them **in
the exact order listed in `src/js/manifest.json`** — it does not resolve
`import`/`export`. This was a deliberate choice: converting ~2,400 lines of
tightly-coupled canvas/editor code to real ES modules means tracking every
cross-reference between sections by hand, which is a good way to introduce a
subtle bug in code with no automated test coverage.

If you want real modules later (so a bundler can tree-shake, or so your
editor can jump to definitions across files), that's a good follow-up
project — but do it as its own change, separate from any feature work, so a
behavior change and a structural change never land in the same commit.

## Commands

```
npm install       # only needed once, and only for the optional --minify flag
npm run build     # builds dist/FriendShaped.html (the lite single file) and dist/site/ (the hosted site)
npm run dev       # builds once, then rebuilds on any change under src/
npm run build:min # same, but minifies JS and CSS with esbuild (~10% smaller)
npm run serve     # build once, then serve dist/site/ on localhost so you can test the hosted version in a browser
npm run release   # build, then copy FriendShaped.html and site/ to the repo root (see below)
npm test          # run the unit tests in tests-unit/ (see tests-unit/README.md)
```

`npm install` is optional for everyday development — `npm run build` and
`npm run dev` work with zero dependencies. It's only needed for
`build:min`, which shells out to esbuild if it's installed and prints a
warning (not an error) and falls back to unminified output if it isn't.

## Adding or changing a font

A font's **key** is saved inside every drawing that uses it, so never rename or remove one.

A *family* (Lato) is one row in the picker. Its *faces* are the fonts the text is actually drawn in: Regular, Bold, Light
Italic and so on, each its own `.woff` file and its own key. Bold and Italic in the text panel, and the Style menu next
to them, move between the faces of the family. A family with no bold (or no italic) face has that button switched off:
nothing is ever faked. There are no variable fonts either, because opentype.js can't read their axes.

1. Latin fonts from Google Fonts: add a line `['key', 'fontsource-package', 400]` to `NEW_FONTS` in
   `scripts/fetch-fonts.js` and run `node scripts/fetch-fonts.js` (needs internet). It downloads the Latin subset
   (`src/fonts/<key>.woff`), the license text (`src/fonts/licenses/<key>.txt`), and rewrites `manifest.json` and
   `CREDITS.md`. A font from elsewhere: drop the `.woff` in `src/fonts/` yourself (not `.woff2`, which opentype.js
   can't read), add its license to `licenses/`, and add `"key": "fonts/key.woff"` to `src/fonts/manifest.json`
   and a row to `CREDITS.md`.
2. Add `['key', 'Label', 'category']` to `FONT_DEFS` in `src/js/03-fonts-runtime.js`. Categories are `sans`,
   `serif`, `script`, `display`, `decorative` and `international`; the picker lists fonts in this order within
   each category. If the font's name is a poor sample of it (a Chinese font), add a line to `FONT_SAMPLES`.
3. `npm test` (it checks that the list, the manifest, the files and the licenses all agree, and that every font file is
   a clean WOFF whose every glyph draws: `tests-unit/font-files.test.js`), then `npm run build` and try the font in
   the picker.
4. `node scripts/verify-fonts.js` (needs internet) to confirm every font and license is byte-identical to the Fontsource
   package in `CREDITS.md`. A font from elsewhere won't be covered by it: say where it came from in `CREDITS.md`, and
   see `SECURITY-REVIEW.md` for the checks it should get instead.

**Weights and italics come with the family.** `scripts/fetch-fonts.js` downloads every Latin weight and italic the
Fontsource package has, one `.woff` each, named `<family>-<weight>` with an `i` after for italic (`lato-700i`), and writes
the list to `src/fonts/faces.json` (`{ "lato": [["lato-100", 100], ["lato-100i", 100, 1], ...] }`), which the build puts in
both HTML files. So adding Lato to `NEW_FONTS` and `FONT_DEFS` is all it takes to get its ten faces. Faces that already
had a key of their own keep it (`inter-xb` is Inter at weight 800, `lora-b` is Lora Bold), and a family whose first face
isn't weight 400 says so in `FONT_DEFS` with `{ w: 800 }` (Nunito, Fredoka). The extra faces share the family's license,
so they need no license file or credits row. A face added by hand (a font from elsewhere) can be listed right in its
`FONT_DEFS` entry instead: `{ faces: [['key-700', 700], ['key-700i', 700, 1]] }`.

**Which build carries which font.** `src/fonts/builds.json` lists the fonts built into each HTML file: `core` for the
hosted page (just enough to start: the default font, `inter-xb`, and the one the wordmark is drawn in, `bungee`) and
`lite` for the single file (keep it small: the whole file is downloaded and emailed around). Both must keep
`inter-xb` and `bungee`. In the single file only the fonts in `lite` exist (a family that isn't there isn't in the picker,
and text in it opens in Inter with the usual "font was missing" message). The hosted site has every font in
`manifest.json`.

Size matters most for `lite`, which is embedded as base64 in the one HTML file. Latin fonts are about 15 to 65 KB each;
the Chinese font is 0.8 MB, which is why only one is included (`python3 scripts/subset-cjk.py` makes it). A hosted font only
costs a visitor anything when it is used, so the full library can grow much larger.

How a font gets used: fonts are parsed the first time they are used, not at start-up. In the hosted build, a font that
isn't built in is fetched first: picking it in the picker, opening a drawing or importing an SVG that uses it waits for
it (opening a drawing waits at most a few seconds). If text is ever laid out before its font has arrived, the default font
stands in and the text is laid out again when the real one lands (`fontArrived`). A font that can't be fetched leaves the
text as it was and says so once. Fonts a person adds from their computer ("Yours") are kept in this browser's IndexedDB
(`meta` store, key `font:...`) and loaded before the drawing is restored (`loadUserFonts`, called from `restoreSession`).

## Libraries and the Content Security Policy

paper.js and opentype.js are built into the page from `node_modules` (pinned to exact versions in `package.json`), not
loaded from a CDN, so FriendShaped never contacts another server and the single file works offline. To update one,
`npm install --save-exact paper@x.y.z` (or `opentype.js@x.y.z`), rebuild, and run the tests.

`build.js` also writes a Content Security Policy into the page's `<head>` (where `src/index.html` says `<!--CSP-->`):
only the page's own four scripts may run (each allowed by its SHA-256 hash, recomputed on every build), the page may
fetch only from where it was served (the fonts folder and `version.json`), and pictures may only be `data:` or
`blob:` URLs. If a change needs something new (a web worker, a picture from a server...), change `cspFor()` in
`build.js` rather than loosening the page; a `tests-unit/fonts.test.js` check fails if the policy and the scripts
disagree. Don't add inline event handlers (`onclick=`) to `src/index.html`: the policy blocks them.

## Editing a section of the app

Open the file under `src/js/` that matches what you're changing (the
filenames describe the sections: `10-perspective.js`, `16-export.js`, etc.).
Functions in one file can freely call functions defined in another, exactly
as before — they're not imported, they're just in scope because
`build.js` concatenates everything into one script. `npm run dev` will
rebuild automatically as you save.

## Adding a tool

Tools and drags are entries in two tables in `src/js/09-pointer-interaction.js`,
so a new tool lives in its own file and nothing else has to change:

```js
TOOLS.brush = {
  key: 'k', cursor: 'draw',               // keyboard shortcut and pointer style
  down(e, p) { drag = { type: 'brush', pts: [p] }; },   // p is in page coordinates
  keys(e) { return false; },              // return true when the tool used the key
  overlay() { return false; },            // draw over the canvas; true hides the selection handles
  enter() {}, leave() {}                  // when chosen, and when another tool is
};
DRAGS.brush = { move(p, e) {}, end(d, e) { commit(); }, overlay() { return true; },
                cancel(d) {} };           // optional: a second finger arrived, so the drag is abandoned
```

Add the file to `src/js/manifest.json` after `09-pointer-interaction.js`, and a
toolbar button with `data-tool="brush"`.

Undo: `commit()` records the drawing as a new step. A change kept outside the
drawing's JSON (pixels in a paint layer, say) can pass
`commit({ undo() {}, redo() {}, forget() {}, bytes })`; the history calls those
when stepping back and forward, and `forget()` when the step is dropped. The
history keeps at most 100 steps and about 48 MB (`HISTORY` in
`07-history-autosave.js`).

## Releasing an update

1. Make your changes under `src/`.
2. `npm run build` and open `dist/FriendShaped.html` in a browser, and `npm run serve` to try the hosted version
   (`dist/site/`) at the address it prints, which is where the on-demand fonts get exercised.
   Run `npm test` first, then actually click through it — draw a shape, add text, combine two shapes,
   import a photo and mask it, export a PNG. The unit tests cover
   geometry, SVG export and boolean ops, but not the canvas/editor UI, so this manual pass is the real
   safety net right now.
3. If this is a new version, rewrite `WHATS_NEW` in `src/js/20-boot.js` (one or two sentences on what changed). FriendShaped shows
   it once, with "Updated to v…", the first time a different version opens in a browser, and keeps it in About, so it is easy
   to tell that the new file is the one running. Then run `npm version 1.7.0 --no-git-tag-version`
   (with the real number). That updates `package.json` and
   `package-lock.json` together. `package.json` is the only place the version
   is written: the build stamps it into the page title and the About box,
   and the output file is always named `FriendShaped.html`, so download links never
   change. A unit test fails if a version number is hard-coded anywhere else.
4. `npm run release` — this rebuilds and copies `FriendShaped.html` (the lite single file) and `site/` (the hosted
   page and its `fonts/` folder) to the repo root. To publish the hosted version, upload the contents of `site/`.
5. Commit your `src/` changes together with the updated `FriendShaped.html` and `site/`.
   CI (`.github/workflows/build.yml`) will fail the build if the root file or `site/`
   and a fresh build of `src/` ever drift apart, which mostly protects
   against forgetting step 4.

## What CI actually checks

`.github/workflows/build.yml` runs `npm run build` on every push and pull
request, runs `npm test`, then diffs the build result against the `FriendShaped.html`
committed at the repo root and `dist/site/` against the committed `site/` folder. It is **not** a functional test —
it can't click buttons or draw shapes — it only proves the build still
produces valid, reproducible output and that nobody forgot to re-run the
release step. The manual browser pass in step 2 above is still what catches
actual behavior bugs.

## How erasing works

The Eraser never changes a photo. An erased object carries `o.erase`, the id of a small picture in the
`images` map (flagged `mask: true`) that sits over the object's box: white shows the object, black hides it,
grays fade it. `objView` draws the object through that picture as an SVG `<mask>`, so the canvas, SVG export
and PNG/JPG/WebP export all share one description (`04d-erase.js`).

- While a stroke is drawn it is a vector path inside the mask (`eraseLive`), so the preview is exactly what
  gets saved. On release, `09c-eraser.js` renders the same SVG over the old mask into a canvas, encodes a new
  PNG, points `o.erase` at it and records one undo step. Old mask pictures stay until the history drops them,
  so Undo is just the drawing's JSON stepping back.
- Mask pictures are stored, saved in project files and cleaned up like photos, but they don't count toward
  `LIMITS.photos` (`docPhotoIds`).
- Not supported yet, with a message instead: tilting an erased photo (Perspective) and using one as a photo
  mask. Both would need to bake the erasing into the photo's pixels first.

## How painting works

The Brush paints on a **paint layer**: an object like a photo (`kind: 'image'`) with `o.paint: true`, as big as the
page, whose picture each stroke repaints. It reuses everything the Eraser does:

- A stroke is a vector path in `eraseLive` while it is drawn (a colored path over the layer's picture, see
  `paintView` in `04d-erase.js`), then `09c-eraser.js` renders the same SVG on top of the layer's old picture
  into a canvas, encodes a new PNG, points `o.img` at it and records one undo step. Old pictures stay until the
  history drops them. A new layer is made at pointer-down but joins the history together with its first stroke, so
  Undo takes both away. Until then it shows a clear 1 x 1 stand-in picture.
- Strokes are smooth (`strokeAdd` curves through the midpoints between pointer positions) and a whole stroke has
  one opacity, so it doesn't build up where it crosses itself.
- The picture has `PAINT.density` (2) pixels per page unit, at most `LIMITS.edge` on the long side.
- The Eraser on a paint layer removes paint from the picture (`destination-out`) instead of using an erase mask,
  so painting over an erased spot works. Restore only exists for masks, so it's refused on paint layers.
- Paint layers cover the page, so clicks go through them (`pointer-events: none`) and a marquee skips them. The
  Select tool takes a layer only where it has paint: `paintLayerAt` (`09d-brush.js`) checks the layer's picture
  (an alpha copy kept in `paintHit`, refreshed by `warmPaintHits`) within a few screen pixels of the pointer, and
  only for layers above whatever object was hit, so a click on a shape in front still gets the shape. You can also
  choose one in the Layers tab, or just keep painting (the brush reuses the selected paint layer, or the one on top
  when nothing is selected).
- Their pictures are stored and saved like photos but don't count toward `LIMITS.photos` (`docPhotoIds`).

## How the eyedropper works

The small dropper beside each color (Fill, Outline, gradient color, page Background, and the Brush bar) starts
`TOOLS.eyedropper` (`09e-eyedropper.js`). It has no shortcut key and no toolbar button; it remembers the tool
you were using, and goes back to it after a pick, Esc or Cancel.

- The color is read from a picture of what is on screen, so it includes every layer, opacity, blend modes, photos
  and paint layers, and ignores hidden objects. `edRender` draws `buildSVG(doc.objects, ...)` (plus the page color,
  under everything and only on the page) at the size of the canvas, so one picture pixel is one screen pixel at the
  current zoom, and keeps the pixels with `getImageData`. `04e-eyedrop.js` has the pure parts: `dropRegion`
  (which part of the page, and the picture size, capped at `DROP.maxPixels`), `dropPixel`, and `dropAverage`
  (one pixel, or the 3 x 3 around it; pixels are weighted by opacity, so clear ones don't wash the color out).
- The picture is drawn again (after a short wait) when the view changes, and a pick waits for a fresh one, so
  zooming or panning while the tool is active is fine. Undo and redo are blocked while it is active.
- A pick fills the field the dropper was started from by setting its value and sending the same `input` and
  `change` events a person's own choice sends, so each field's existing code applies it and records one undo step.
- A spot with nothing there (outside the page, or an empty page with no color) picks nothing and keeps the tool.

## How grids work

The Page tab has three grids. The **pixel grid** is the old square one: `S.showGrid`, `S.snap` and `S.grid` live in the session,
not in the drawing. The **column grid** and the **baseline grid** belong to the drawing: `doc.grids = { columns, baseline }`
(`04j-grids.js`), so they are saved in project files and autosave, and every change is one undo step. A drawing that never
used them has no `doc.grids`; `gridsOf(doc)` always returns a complete, clamped copy (both grids off), and `sanitizeGrids`
is what `sanitizeDoc` uses when a file is opened.

- **They are not objects.** They are never in `doc.objects`, so they can't be selected, don't show in Layers and can't reach
  an export (`buildSVG` only draws objects). On the canvas they are two `<path>`s in `#grids` (over the objects, under the
  selection handles) with `pointer-events: none`, so clicks go through them. `drawGrids` (`08-rendering.js`) draws them: thin
  (1 screen pixel) and dashed whatever the zoom, and the path geometry is only rebuilt when a setting or the page size changes.
  Baselines closer than 3 screen pixels are left out while zoomed far out.
- **Percentages.** Column margins (`left`, `right`) and the `gutter` are a % of the page width; baseline `top` and `bottom`
  (where the grid begins and ends) are a % of the page height. So resizing the page re-spreads the grid. The baseline's spacing
  is absolute because it is a type size: `size` x `lh`, the same two numbers a text has (`o.size`, `o.lh`).
  `sanitizeGrids` keeps margins and gutters from squeezing the columns to nothing.
- **Transparency.** The panel's slider shows transparency; the drawing keeps opacity (`1 - transparency`).
- **Snapping.** "Snap to columns" pulls x to a column edge and "Snap to baselines" pulls y to a line, only while that grid is
  showing. A grid line wins when a point (drawing, resizing) or the near or far edge of a moved object is within 8 screen
  pixels of it (`nearGuide`, `guideShift`; `snapX`, `snapY` and `updateMove` in `09-pointer-interaction.js`); anywhere else the
  pixel grid decides, as before. An object's own box is snapped, not the baseline of its text.
- **Match baseline grid.** A button in the Design tab's Text section (`#tx-tobase`, `13-inspector.js`) sets the selected text's size and
  line height to the baseline grid's with `applyWholeStyle`, so its lines are one grid line apart (a line is `size x lh` tall, which is
  exactly the baseline's spacing). It is the same as typing the two numbers into Size and Lines for the whole text: letters that had a
  size or line height of their own are brought back to it. Its label shows the two numbers, and it is off when the text already has them
  (or is locked). The baseline's size (4 to 400 px) and line height (0.6 to 3) are limited to what a text can be, so a text can always match.
- **Shortcut.** Ctrl+' (Cmd+' on a Mac) shows or hides the grids that are on (`toggleGrids`, `15-page-tab.js`). It remembers which they
  were until the page is reloaded, and with none on it shows the column grid. Like the checkboxes, each use is one undo step.

## How in-place text editing works

Text objects are drawn as outlines (`buildText`), so there is no text on the canvas to type into. While one is
edited (`startTextEdit` in `09f-text-edit.js`: double-click, Enter on a selected text, or placing new text with
the Text tool), `#text-edit`, a transparent `<textarea>`, is laid over it by `tePlace` using the object's box,
the canvas zoom and the object's angle, with the same font (the embedded font data is loaded as a `FontFace`),
size, line height, letter spacing and alignment. The browser draws the caret and selection and handles the
keyboard, input methods and mobile keyboards. Each `input` event sets `o.text`, calls `refresh(o)` and redraws,
so the outlines underneath update as you type.

- Editing ends on Esc, Ctrl+Enter, or the box losing focus (any click elsewhere); that is one undo step. A new
  text object is only committed to the history at that point, so Undo removes it whole; text left empty is deleted.
- The browser lays text out slightly differently from opentype.js, so the caret can sit a little off the outlines
  (up to about 1% of the line's length in the bundled fonts; most are under 0.5%).
- Mirrored text (`fx`/`fy`), locked and hidden text fall back to the Design tab's text box.
- The Design tab's text box and this one never edit at once: focusing the other one ends the edit.
