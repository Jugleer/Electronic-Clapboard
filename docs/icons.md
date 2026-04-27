# Icon library — sources, licence, and refresh procedure

## Source

The icon library is vendored from **[Tabler Icons](https://tabler.io/icons)**,
pinned at version **3.24.0** (see [tools/rasterise_icons.py](../tools/rasterise_icons.py)
`TABLER_VERSION`). Tabler is published under the **MIT License**, which permits
redistribution as part of the firmware/editor bundle with attribution. A copy of
the licence appears below.

We ship the **outline** weight only. The masters are deterministic 128×128
grayscale PNGs produced from Tabler's official SVGs at vendoring time. PNG
masters live in [web/public/icons/](../web/public/icons/) and are committed to
the repository — they are the artefacts the editor actually loads at runtime.

## Why pre-rasterised PNG, not runtime SVG

The visual-regression snapshot test ([web/src/editor/icons/snapshot.test.ts](../web/src/editor/icons/snapshot.test.ts))
asserts the byte output of `rasterizeElements` for a canonical icon at a fixed
size against a committed binary fixture. Browser SVG rasterisers (Skia in
Chromium, WebKit's CG, Firefox's own) and the test environment's resvg-based
rasteriser do not produce byte-identical output for the same SVG. By
pre-rasterising the SVG once into a checked-in PNG, every consumer's render
path collapses to `ctx.drawImage` + bilinear scale + `packFrame` threshold —
all of which are byte-stable across the browser's Skia and @napi-rs/canvas's
Skia.

## Refreshing the library

1. Edit the `ICONS` list in [tools/rasterise_icons.py](../tools/rasterise_icons.py)
   to add, remove, or relabel an icon.
2. Run the script:
   ```
   python tools/rasterise_icons.py
   ```
   Network is required for the first run — Tabler SVGs are fetched from
   jsDelivr and cached under `tools/icons-cache/` (gitignored). Reruns are
   offline-fast.
3. Update [web/src/editor/icons/registry.ts](../web/src/editor/icons/registry.ts)
   to mirror any list changes — the registry is the editor's source of truth.
4. The `npm test` icon-registry test fails CI if `registry.ts` advertises an
   id without a backing PNG, or if a PNG exists on disk without a registry
   entry.
5. If the canonical snapshot icon (`film/movie`) changes visually, refresh
   the fixture deliberately:
   ```
   cd web && UPDATE_ICON_SNAPSHOT=1 npx vitest run src/editor/icons/snapshot.test.ts
   ```
   Commit the regenerated `web/src/__fixtures__/icon_movie_64.bin` along with
   any code change that motivated it.

## Categories

| Category | Count | Notes |
| -------- | ----- | ----- |
| `film` | 25 | Production-related: clapboard, camera, microphone, lighting, talent, time. Loaded eagerly on App mount. |
| `arrows` | 10 | Navigation arrows in 8 cardinal/intercardinal directions plus undo/redo curves. |
| `symbols` | 12 | Geometric primitives + punctuation marks (plus, minus, x, check, ?, !). |
| `emoji` | 8 | Tabler `mood-*` outlines — line-art faces. |
| `misc` | 8 | General utility (home, pin, bell, Wi-Fi, QR, battery, …). |

Other-than-`film` categories are loaded lazily — the IconPicker accordion
fires `preloadCategory(name)` the first time a category is expanded.

## Tabler licence (MIT)

```
The MIT License (MIT)

Copyright (c) 2020-present Paweł Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
