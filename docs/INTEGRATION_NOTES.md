# Integration verification (local-art, real data, real GPU)

Checked `origin/integration` at 66102e9 (loading and error screens) on 2026-10-08 in a clean worktree, dev server port 5176, Playwright Chromium on the GPU (WebGPU), 1600x900. Screenshots are in `shots/local/8/` (gitignored). fps was 60 in every scene.

| Scene | URL / action | Result |
|---|---|---|
| Start | `game.html` | OK. Main menu (New game, Continue, Load game, Options) over the zone 1 scene. The panel spans the full window width (1600 px) instead of a compact centred box: looks unfinished. |
| Village | `?zone=1&x=930346&y=655026&h=0` | OK. Buildings, trees, grass and hills render; no console errors. |
| Town scene | `?zone=1&x=660800&y=927000&h=192`, hold W for 4.5 s | Dialogue ("The path turned... LaMut ... go in for supplies?") shows correctly. After answering Yes the whole page goes **black** (no still image, no hotspots, no HUD) and stays black for 15 s. No console error. Probably the town view fails to draw its background; worth a look. |
| Combat | `?zone=7&x=791141&y=988500&h=0` | Combat starts on arrival: grid, three scorpions, party sprites and action panel render. Two stray torch-like sprites float above the grid near the hill. |
| Map | Tab in zone 1 | Opens: a coarse grid of explored tiles plus the party arrow and "facing N". Works, though it is only the tile layout. |
| Chapter start | `?chapter=2` | **Black screen**, HUD says zone 11 at pos (8, -8) day 4 05:00: the party starts outside any geometry. The chapter 2 start position or zone looks wrong (zone 11 is a mine). |

Other notes
- A 404 for one resource (probably a favicon) appears on every load.
- `scripts/shoot.mjs` ignores Enter-prompted dialogue: use `Enter` as a step after the walk (as above).
