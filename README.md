# FriendShaped

- FriendShaped is an in-browser vector and bitmap graphics editor for classroom use.
- Current functionality includes drawing shapes, drawing with the pen and pencil, editing the points and curves of any shape, editing text in place on the canvas (a click makes text as wide as its words; drag a box to make text that wraps inside it) with a library of 50+ font families in categories (with all their weights and italics, and Chinese, plus your own), solid fills and linear or radial gradients with up to eight colors (including see-through ones), blend modes, combining shapes (unite, subtract, intersect, exclude), grouping (shown as folders in the Layers tab), mirror, import photos and use shapes or text as photo masks, paint with a soft or hard brush on paint layers, erase parts of a photo (and bring them back again, since nothing is deleted) or rub out paint, pick any color from the drawing with an eyedropper (one pixel or the average of 3 × 3, from all layers together), import SVG drawings as editable shapes, then export PNG, JPG, WebP or SVG.
- Privacy is a design goal (COPPA/FERPA-conscious): no accounts, no servers, no analytics, no uploads. Drawings and photos live only in the student's browser (IndexedDB).

## Using FriendShaped

**Single file:** download `FriendShaped.html` from this repo and open it in a browser. That's it — no install, no
accounts, no server-side component. It has a small set of fonts built in, so it stays light enough to email or put on a
USB stick.

**Hosted:** download the `site/` folder from this repo: an `index.html` and a `fonts/` folder with the whole font library
(every weight and italic). Upload those two things to any static web host (GitHub Pages, Netlify, a school server) and
open the address. Fonts are fetched one at a time, only when someone uses them, and the browser keeps them. A page
opened straight from disk can't fetch its fonts folder; use the single file for that.

## Developing FriendShaped

The single HTML file above is a *build output*, not something to hand-edit.
The actual source lives under `src/` as smaller, focused files, and a small
Node script glues them back into that one file. See [BUILD.md](BUILD.md) for
the full layout, the available `npm run ...` commands, and the release
checklist.

```
npm run build   # produces dist/FriendShaped.html (single file) and dist/site/ (hosted) from src/
npm run release # builds, then copies both to the repo (FriendShaped.html and site/)
npm run dev     # rebuilds automatically as you edit src/
```
