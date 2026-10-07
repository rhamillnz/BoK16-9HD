# Local backlog (Sonnet / Gemini sessions on Reuben's PC)

Work that needs this PC: the original game data, the third-party art packs, Blender and a
real GPU. The cloud agent works through `docs/BACKLOG.md` on the `integration` branch;
this file is for local sessions. Opus reviews and merges both.

## Setup and rules

- Repo: `C:\BoK16-9HD`. **Work in your own worktree** so you don't disturb the main checkout
  or its dev server: `git worktree add C:\BoK16-9HD-local -b local-art origin/integration`
  (or reuse it if it exists; `git pull --rebase origin integration` first).
- Run your own dev server there: `npx vite --port 5176 --strictPort` (5173 is the main one).
- Commit to branch `local-art` and push it (`git push -u origin local-art`). **Never push to
  `main` or `integration`.** End commit messages with
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- `npx tsc --noEmit` and `npx vitest run` must pass before every commit.
- Keep `src/game/main.ts` edits minimal (the cloud agent edits it too).
- **Never commit original game data or anything derived from it** (`art/reference/`,
  `art/derived/`, upscaled sprites). Only CC0 art (Quaternius packs) may go in `public/`.
  Credit new packs in `CREDITS.md`.
- Game data: `C:\Program Files (x86)\GOG Galaxy\Games\Betrayal at Krondor` (served at `/bak/`).
- Art packs (CC0, gitignored): `art/incoming/*`. Folder names contain `[Standard]`, so use
  `-LiteralPath` in PowerShell.
- Reference art (copyrighted, reference only, never commit): `art/reference/riftwar/`.
- Art direction: **stylised** (hand-painted, chunky fantasy, Quaternius-like), not photoreal.

## Tools you should reuse

| Tool | What it does |
|---|---|
| `tools/blender/fit_override.py` + `art/jobs/*.json` | Fit a glTF to an original model's height (optional `width` cap, `textures` swaps), 512px WebP textures, export `.glb` |
| `tools/blender/build_house.py` + `art/jobs/buildings-zone1.json` | Assemble a gabled building from Medieval Village MegaKit modules and fit it per-axis to the original bounding box |
| `tools/blender/probe_dims_all.py` | Print module dimensions of a kit |
| `scripts/export-models.ts` | Export a zone's original models as OBJ reference geometry |
| `scripts/probe-buildings.ts`, `scripts/probe-vegsprites.ts`, `scripts/probe-allsprites.ts` | Original model sizes and sprite usage per zone |
| `tools/upscale/upscale.py` (venv in `tools/upscale/.venv`) | Real-ESRGAN 4x upscale of RGBA sprites |
| `scripts/export-sprites.ts` | Export a zone's slot images as PNGs |
| `scripts/shoot.mjs` | Real-GPU WebGPU screenshot: `node scripts/shoot.mjs out.png "http://localhost:5176/game.html?zone=1&x=..&y=..&h=.." wait:4000` |
| `public/models/manifest.json` | Override registry: original model name -> `.glb` (render units, origin at base centre) |

Blender runs headless: `blender --background --factory-startup --python <script> -- <args>`.
Units: 1 render unit = 100 BaK units; Y up; `?x=&y=&h=` and `?zone=N` URL params place the party.
Every visual change must be checked with `scripts/shoot.mjs` screenshots (and still 60 fps).

## Backlog (in order)

1. **Remaining buildings**: church (17.0 x 13.9 x 9.5, main hall + annex), temple (13.5 x 23.8 x 10.5),
   illhouse (18 x 18 x 8, zone 3), rftshack (14 x 10 x 7, zone 9), catapult (zone 6, use kit/props).
   Extend `build_house.py` (e.g. annex/tower options) rather than one-off scripts.
2. **Roof colour variety**: per-building roof tint variants (terracotta, slate grey-blue, dark
   green-grey, thatch-brown) via the `textures` swap or material tint; vary between `house`,
   `house1`, `inn`, `blcksmth` so villages aren't uniformly red.
3. **Hills**: landscape/hill models (`zero*`, `one*`, `landscp*`, `genmtn`, `stonemtn`) are flat-shaded
   palette colours. Give them smooth normals and the stylised terrain material
   (`src/render/terrainMaterial.ts`), slope-based rock colouring, and scatter nature-kit rocks/bushes
   on them. Changes go in `src/render/zoneScene.ts` / new modules.
4. **Road verges**: soften road and path edges into the grass (e.g. grass clumps biased to road edges,
   or an edge-darkening/blend band in `src/render/roadMaterial.ts`), plus occasional RockPath
   stones from the nature kit along roads.
5. **Props**: replace remaining sprite/flat props with kit models through the manifest: chests
   (`chest_nl`, `box`, `bag`), fences (`fence`), signs (`sign1-4`, `signpost`), wells, tents,
   campfires (`fireold`, `campfire`), stumps, dirt piles, gravestones (`tstone*`, `tmbstone`).
   Fantasy Props MegaKit isn't downloaded; use Medieval Village props (crates, fences, wagon) and
   nature-kit rocks, and list what's missing for Reuben.
6. **Bodies** (`dbody1`, `dbody2`, `rogebody`, `morhbody`, ...): posed lying figures built from
   Universal Base Characters + Modular Character Outfits in Blender (a death pose from the
   Universal Animation Library), fitted to the original sprite footprint.
7. **Upscale every remaining original sprite, item icon and portrait** with `tools/upscale`
   into `art/reference/Z??/slots-4x/` (gitignored); check a few in game.
8. **Verify the cloud's `integration` branch** periodically: run it on port 5176, screenshot
   the start, the village, a town scene, combat and the map, and write findings to
   `docs/INTEGRATION_NOTES.md` on `local-art`.

When an item is done, tick it here, commit, push `local-art`, and continue with the next.
