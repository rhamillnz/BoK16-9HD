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

Preferred licences: **CC0** (no attribution needed), then CC-BY (credit in
`CREDITS.md`). Avoid "NC" (non-commercial) and editorial-only licences.
