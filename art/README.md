# Art pipeline

- `art/incoming/<pack-name>/`: drop downloaded base models and textures here, one
  folder per pack, with its licence file or a `SOURCE.txt` (URL and licence). This
  folder is gitignored: licences vary and files are large.
- Blender (headless) scripts in `tools/blender/` clean up, rescale, decimate and
  export them as `.glb` into `public/models/` (committed only when the licence allows
  redistribution, e.g. CC0).
- Replacements are keyed by original model name (e.g. `tree1`, `inn`, `chest_nl`)
  in an override manifest; anything without an override falls back to the original
  geometry from the game data.

## Reference geometry from the original game

Export a zone's original models (correct scale, palette colours) and turn them into
`.glb` plus preview renders with headless Blender:

```sh
npx vite-node scripts/export-models.ts 1            # -> art/reference/Z01/*.obj, *.mtl, models.json
blender --background --factory-startup --python tools/blender/obj_to_glb.py -- art/reference/Z01 art/reference/Z01 --only inn,church
```

Units are the renderer's: 1 unit = 100 BaK units, Y up, north = -Z, origin at the
model's placement point (ground level). Build replacements to the same footprint and
height so they line up with collision outlines. `art/reference/` comes from the
original data, so it is gitignored and must never be committed.

Preferred licences: **CC0** (no attribution needed), then CC-BY (credit in
`CREDITS.md`). Avoid "NC" (non-commercial) and editorial-only licences.
