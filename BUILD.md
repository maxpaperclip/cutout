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
    05-svg-export.js
    06-boolean-ops.js   unite / subtract / intersect / exclude (paper.js)
    07-history-autosave.js  Undo/redo + IndexedDB persistence
    08-rendering.js
    09-pointer-interaction.js
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
