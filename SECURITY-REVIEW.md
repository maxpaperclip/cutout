# Security review

A record of what has been checked, how, and what came of it, so the next review can start from here instead of from
scratch. Add a new dated section at the top for each review; keep the old ones.

## October 2026 (v1.33.1)

Reviewed by Claude (Anthropic's AI assistant) at the maintainer's request, at commit `992e636`, on 17 October 2026.
The fixes are in v1.33.1 (pull request #42).

### 1. The app's own code

Everything that reads something from outside the app was traced to where it ends up: SVG import, opening a project
file, photos, fonts added by a student, autosave (IndexedDB and localStorage), export, and the update check. The
code builds the page with `setAttribute` and `textContent` (no `innerHTML` with outside data), project files are
checked field by field (`sanitizeDoc`), and SVG export escapes every value. No way to run script was found.

| Finding | Severity | Status |
|---|---|---|
| **An imported SVG could open another website.** The SVG cleaner removed a list of known-dangerous things and kept everything else, and paper.js puts the cleaned SVG into the page for a moment while reading it. An HTML `<meta http-equiv="refresh">` inside an SVG took the tab to any address. | Medium–High | Fixed: the cleaner now keeps only a list of known SVG elements and attributes (`svgSafeParse` in `src/js/18b-svg-import.js`) |
| **An imported SVG could contact other servers** (revealing the student's IP address) through HTML preload links, `<feImage>` with a link under a non-standard prefix, CSS-escaped `url()` in `style=""`, and HTML elements with backgrounds. | Medium | Fixed by the same change |
| **A project file could change every object in the page** (`Object.prototype`): a text whose font was `"__proto__"` set `Object.prototype.failedAt`, holding up font loading for 15 seconds. | Low | Fixed: the font tables have no prototype (`src/js/03-fonts-runtime.js`) |
| **paper.js and opentype.js were loaded from a CDN** (jsDelivr) without integrity checks: whoever controlled the CDN controlled the app, the CDN saw every visit, and the single file needed internet. There was no Content Security Policy. | Medium | Fixed: both are built into the page; both builds carry a CSP (`cspFor()` in `build.js`) |
| CI used actions by tag and the default token permissions. | Low | Fixed: pinned to commit SHAs, `permissions: contents: read` |

Tested in headless Chromium against both builds, before and after; the hostile SVGs are kept as regression tests in
`tests-unit/svg-sanitize.test.js`.

Not fixed, noted: project path data (`nat.d`) has no length limit, so a huge project file could freeze the tab;
fonts added by a student have no size limit.

### 2. Third-party libraries (built into the page)

| Library | Version | Provenance | Known vulnerabilities | Maintenance |
|---|---|---|---|---|
| paper.js | 0.12.18 | npm `paper-core.js` is byte-identical to the GitHub tag `v0.12.18`; `paper-core.min.js` is reproduced byte for byte by minifying it with uglify-js 3.13.1, the version in the project's lockfile | None published | Widely used, but quiet: last release and last commit July 2024 |
| opentype.js | 1.3.4 | npm `dist/opentype.min.js` is byte-identical to the GitHub tag `1.3.4` | Two crash bugs from crafted fonts (circular composite glyphs; recursive CFF subroutines), fixed upstream in 1.3.5 (April 2026). A third fix (hinting loops) doesn't apply: FriendShaped never turns hinting on | Active again since 2026; 1.3.5/2.0.0 published with npm provenance from GitHub Actions |

**Decision: stay on opentype.js 1.3.4 for now.** 1.3.5 is the 2.0 rewrite (the same code as 2.0.0), and in a trial
build it broke text: Inter throws "substitutionType 62 … not yet supported" and some outlines come out as `NaN`. The
two crash bugs only matter for a font a student adds themselves, and in the app they end as "That font file could not
be read", with the editor still working and the drawing reopening normally. The built-in fonts are not affected
(section 3). Revisit when opentype.js 2.x has had a few more releases.

### 3. The font library (`src/fonts/`, 307 files)

| Check | Result |
|---|---|
| **Provenance.** Every face compared byte for byte (SHA-256) with the Latin file of the Fontsource package and version in `CREDITS.md` (`node scripts/verify-fonts.js`) | All 306 faces match `@fontsource/*` 5.3.0 |
| The Chinese font, rebuilt with `python3 scripts/subset-cjk.py` (fonttools 4.65.0, `@expo-google-fonts/noto-sans-sc` and `@fontsource/noto-sans-sc` from npm) | Byte-identical to the committed `noto-sans-sc.woff` |
| **Integrity.** WOFF header and table directory: real length, no metadata or private block, no gaps or bytes hidden between or after tables, every table unpacks to its stated size; every table decoded by fonttools | All 307 clean |
| Kinds of tables | Only ordinary TrueType tables (`glyf` outlines, layout, metrics, names). No CFF outlines and no hinting programs (`fpgm`, `prep`, `cvt`), the parts of opentype.js 1.3.4 with known bugs |
| **Parser safety.** Every glyph of every font (95,513) drawn with opentype.js 1.3.4 as the app draws text; composite glyphs checked for loops with fonttools | All draw, no broken outlines; no loops (deepest nesting 3) |
| `site/fonts/` against `src/fonts/` | Identical |
| **Licenses.** Each `licenses/<family>.txt` compared with its package's `LICENSE`; each license's type compared with `CREDITS.md` | All 51 match their packages; types agree (SIL OFL 1.1, or Apache 2.0 for six families). Noto Sans SC's Reserved Font Name is "Source", which the subset doesn't use |

**One licensing gap (not security):** the single file (`FriendShaped.html`) carries 10 fonts but not their license
texts. Each font names its license inside itself, and the About box says where the texts are, but the SIL OFL
("each copy contains … this license") and the Apache License (Permanent Marker is in the single file) both expect
the text to travel with the copy. The hosted `site/` is fine: `fonts/licenses/` goes with it. Suggested fix: build
the license texts of the single file's fonts into the page (in About, or as a comment).

`tests-unit/font-files.test.js` now repeats the integrity, table-kind and every-glyph checks on every `npm test`,
so a font that is changed or added is checked automatically; it fails on any kind of table this review didn't cover.

### How to repeat this review

1. `npm ci && npm test`: the SVG cleaner, font tables, CSP and font file checks.
2. `npm run verify:fonts` (needs internet): every font and license against upstream.
3. `python3 scripts/subset-cjk.py`, then `git status src/fonts`: the Chinese font rebuilds the same.
4. `npm audit` and the libraries' advisories (GitHub Security Advisories, Snyk) for paper and opentype.js.
5. Re-read the places outside data comes in (section 1) for anything new.

Worth doing again when a library is upgraded, fonts are added or replaced, a new way to bring something into the app
is added (a new file type, a link, a server), or about once a year.
