# Screensaver image masters

Drop PNG/JPG/SVG files in this directory and the screensaver panel will
auto-discover them on the next dev-server restart (Vite globs at build
time, not at runtime). Any aspect ratio is fine — the screensaver fits
the image into the 800×480 frame with letterbox/pillarbox margins, then
applies Floyd–Steinberg dither before sending.

The three SVGs that ship in-repo are public-domain mathematical
illusions (Penrose triangle, impossible cube, hexagonal tessellation) —
in the spirit of M.C. Escher without redistributing his (still
copyrighted) works.

## Adding your own Escher scans

Escher's prints are under copyright until ~2042 (life + 70 in most
jurisdictions). For personal use on your own device, drop scans here
and the screensaver will pick them up. **Do not** commit Escher (or
other copyrighted) images to a public Git remote — see the gitignore
note below.

If you want a clean separation, name them `personal-*.png` and the
project `.gitignore` excludes that prefix from this directory.
