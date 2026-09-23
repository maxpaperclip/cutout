# Cutout

- Cutout is an in-browser vector and bitmap graphics editor for classroom use.
- Current functionality includes drawing shapes, editing text, solid, linear and radial gradient fills, combining shapes (unite, subtract, intersect, exclude), mirror, import photos and use shapes or text as photo masks, then export PNG, JPG, WebP or SVG.
- Privacy is a design goal (COPPA/FERPA-conscious): no accounts, no servers, no analytics, no uploads. Drawings and photos live only in the student's browser (IndexedDB).

## Using Cutout

Download `Cutout-v1.6.html` from this repo and open it in a browser, or host
it anywhere that can serve a static file. That's it — no install, no
accounts, no server-side component.

## Developing Cutout

The single HTML file above is a *build output*, not something to hand-edit.
The actual source lives under `src/` as smaller, focused files, and a small
Node script glues them back into that one file. See [BUILD.md](BUILD.md) for
the full layout, the available `npm run ...` commands, and the release
checklist.

```
npm run build   # produces dist/Cutout-v<version>.html from src/
npm run dev     # rebuilds automatically as you edit src/
```
