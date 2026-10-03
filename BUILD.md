# Building Cutout

Cutout ships as **one self-contained HTML file**. No server, no install, no build step required to *use*
it. But that's not how it's made: instead of hand-editing one
massive file, you edit smaller files under `src/`, and a build script
glues them back into the single file you distribute.

## Layout

```
src/
  index.html         Page shell (head, toolbar, panels, dialogs — all the HTML)
  styles.css          All CSS, extracted as-is from the old <style> block
  fonts/
    manifest.json     Maps font keys (e.g. "inter-xb") to their .woff file
    *.woff            The actual embedded fonts, as real binary files
  js/
    manifest.json     Load order for the files below (order matters — see note)
    00-preamble.js     Library check + paper.js setup
    01-helpers.js       $ / $$ / small DOM helpers
    02-icons.js
    03-fonts-runtime.js Parses FONT_DATA into usable fonts (opentype.js)
    04-document-model.js
    04b-groups.js       Groups (folders in Layers): kept beside the flat object list
    04c-path-edit.js    Path geometry shared by the Pen tool and point editing
    04d-erase.js        Erase masks: how an erased object is described and drawn (no DOM, unit tested)
    04e-eyedrop.js      Eyedropper sums: which part of the page to draw, and the average color of 1 or 3 x 3 pixels (no DOM, unit tested)
    05-svg-export.js
    06-boolean-ops.js   unite / subtract / intersect / exclude (paper.js)
    07-history-autosave.js  Undo/redo + IndexedDB persistence
    08-rendering.js
    09-pointer-interaction.js
    09b-pen.js          Pen tool and point editing (pointer and keyboard handling)
    09c-eraser.js       Eraser tool: pointer handling, the brush bar, and baking strokes into a mask or layer picture
    09d-brush.js        Brush tool and paint layers (shares its strokes, bar and baking with the Eraser)
    09e-eyedropper.js   Eyedropper: a temporary tool started from a color field, reads the whole drawing as it looks on screen
    10-perspective.js
    11-editing-commands.js
    12-ui-chrome.js
    13-inspector.js
    14-layers-tab.js
    15-page-tab.js
    16-export.js
    17-projects.js
    18-photos.js
    18b-svg-import.js   Imports SVG files as editable shapes (made safe first)
    19-ui-wiring.js
    20-boot.js
build.js              The build script (plain Node, no required dependencies)
scripts/copy-to-root.js   Copies a finished build to the repo root for release
dist/                  Build output (gitignored by default — see below)
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
npm run build     # builds dist/Cutout.html
npm run dev       # builds once, then rebuilds on any change under src/
npm run build:min # same, but minifies JS and CSS with esbuild (~10% smaller)
npm run serve     # build once, then serve dist/ on localhost so you can test in a browser
npm run release   # build, then copy the result to the repo root (see below)
npm test          # run the unit tests in tests-unit/ (see tests-unit/README.md)
```

`npm install` is optional for everyday development — `npm run build` and
`npm run dev` work with zero dependencies. It's only needed for
`build:min`, which shells out to esbuild if it's installed and prints a
warning (not an error) and falls back to unminified output if it isn't.

## Adding or changing a font

1. Drop the `.woff` file in `src/fonts/`.
2. Add a line to `src/fonts/manifest.json` mapping a short key to it, e.g.
   `"comic-neue": "fonts/comic-neue.woff"`.
3. Add the key to `FONT_DEFS` near the top of `src/js/03-fonts-runtime.js`
   so it shows up in the font picker: `['comic-neue', 'Comic Neue'],`.
4. `npm run build` and check it in the exported preview.

You do not need to touch `build.js` — it reads the manifest and embeds
whatever's listed.

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
2. `npm run build` and open `dist/Cutout.html` in a browser.
   Run `npm test` first, then actually click through it — draw a shape, add text, combine two shapes,
   import a photo and mask it, export a PNG. The unit tests cover
   geometry, SVG export and boolean ops, but not the canvas/editor UI, so this manual pass is the real
   safety net right now.
3. If this is a new version, run `npm version 1.7.0 --no-git-tag-version`
   (with the real number). That updates `package.json` and
   `package-lock.json` together. `package.json` is the only place the version
   is written: the build stamps it into the page title and the About box,
   and the output file is always named `Cutout.html`, so download links never
   change. A unit test fails if a version number is hard-coded anywhere else.
4. `npm run release` — this rebuilds and copies `Cutout.html` to the repo
   root.
5. Commit both your `src/` changes and the updated root HTML file together.
   CI (`.github/workflows/build.yml`) will fail the build if the root file
   and a fresh build of `src/` ever drift apart, which mostly protects
   against forgetting step 4.

## What CI actually checks

`.github/workflows/build.yml` runs `npm run build` on every push and pull
request, runs `npm test`, then diffs the build result against the `Cutout.html`
committed at the repo root. It is **not** a functional test —
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
- Paint layers cover the page, so clicks go through them (`pointer-events: none`) and a marquee skips them; choose
  one in the Layers tab, or just keep painting (the brush reuses the selected paint layer, or the one on top when
  nothing is selected).
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
