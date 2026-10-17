# Unit tests (`tests-unit/`)

These are fast, dependency-light unit tests for the pure logic in
`src/js/` - geometry math, the document model, SVG serialization, and the
shape-combining boolean operations. They run in plain Node (no browser)
using the built-in test runner (`node:test`), so `npm test` finishes in
well under a second.

## How it works

`src/js/*.js` files are plain scripts sharing one global scope (see
`BUILD.md`) rather than ES modules, so there's nothing to `import` directly.
`tests-unit/harness.js` loads the actual, unmodified source of a few of
those files (currently `01-helpers.js`, `04-document-model.js`,
`04b-groups.js`, `04c-path-edit.js`, `04d-erase.js`, `04e-eyedrop.js`, `04f-text-layout.js`, `04g-text-runs.js`, `04h-hyphen-data.js`, `04h-hyphenation.js`, `04i-text-wrap.js`, `04j-grids.js`, `05-svg-export.js`, `06-boolean-ops.js`, `06b-break-apart.js`, `17-projects.js`, `18b-svg-import.js`) into an isolated Node `vm` context,
along with minimal stand-ins for the few things that normally come from the
browser or another src file:

- `paper` - the real `paper.js` library (via the `paper` npm package). Its
  boolean path operations (`unite`/`subtract`/`intersect`/`exclude`) run
  perfectly well headlessly; no canvas or DOM is needed for path math.
- `toast()` / `commit()` - normally show a UI toast / push undo history.
  Stubbed to just record that they were called, so tests can assert
  "this action notified the user" or "this committed a change" without a
  real UI.
- `fontOf()` / `DEFAULT_FONT` - normally parsed from embedded font binaries
  by `03-fonts-runtime.js` (via opentype.js). Stubbed with a minimal fake
  font so `newShape('text', ...)` doesn't throw; text-geometry tests aren't
  the goal here.

Every test calls `loadAppModules()` to get a **fresh** instance (its own
`vm` context, its own `doc`/`S`/`images`, its own `paper` scope), so tests
never leak state into one another.

`svg-sanitize.test.js` is the one exception to "no DOM": the SVG import's
cleaning step (`svgSafeParse` in `18b-svg-import.js`) reads files with
`DOMParser`, so that test runs the real file with [jsdom](https://github.com/jsdom/jsdom)'s
DOM (installed as `jsdom-for-tests`, because paper.js changes how it works in Node when it can find a package named `jsdom`). It feeds in hostile SVGs (scripts, HTML tucked inside the SVG, outside
links, CSS-escaped `url()`s...) and checks that only listed SVG elements and
attributes, and links inside the file, come out.

## Running

```bash
npm test
```

## Adding more coverage

If you pull more logic out of `src/js/` (or add a new file) that's pure
enough to unit test this way:

1. Add the filename to `MODULE_FILES` in `tests-unit/harness.js`, in the
   same order it appears in `src/js/manifest.json`.
2. Add any new function/variable names you want to call from tests to
   `EXPORT_NAMES` in the same file.
3. Write a `*.test.js` file next to the others.

If a function depends on something heavily DOM/canvas-specific (rendering,
pointer interaction, the actual UI wiring), it's a better fit for an
end-to-end/browser test than for this harness - see the project's
Playwright test setup for that layer instead.
