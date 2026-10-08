# Review notes (local-art)

## Item 1: remaining buildings (catapult still open)
- `tools/blender/build_house.py`: refactored into `build_part()`; jobs can now have `parts` (main hall + annexes + `kind: "tower"`), `offset`, `skip` (abutting walls), `door_side`. Old single-block jobs unchanged.
- New `art/jobs/buildings-landmarks.json`: church (hall + annex), temple (2-storey hall, two wings, rear tower), illhouse (L-shape), rftshack. Fitted to original bounding boxes exactly.
- New `public/models/buildings/{church,temple,illhouse,rftshack}.glb`, registered in `manifest.json`.
- Screenshots: `shots/local/1/church-a.png`, `church-c.png`, `temple.png` (zone 1), 60 fps. Blender previews in `shots/build-*.png`.
- Limitations: annexes are parallel to the nave (no cross-gables); wing/annex roofs butt into the main roof; illhouse/rftshack not checked in zones 3/9; catapult not done (needs a prop assembly, not a building).

## Item 2: roof colour variety
- `build_house.py`: job key `"roof"` (terracotta | slate | greygreen | thatch) recolours the round-tile texture (keeps luminance, swaps hue) before WebP export. Rebuilt via the job JSONs.
- Assigned: inn slate, house terracotta, house1 thatch, blcksmth grey-green, church slate, rftshack thatch (temple/illhouse terracotta).
- Screenshots: `shots/local/2/{inn,h1,bs,rs}.png` (zone 1 village), 60 fps. Tint is per model name, so all instances of one building share a colour.
- Opus may want to look at: whether thatch/slate saturation reads right at game lighting; per-instance variety would need runtime tinting.

## Item 3: hills
- New `src/render/hillMesh.ts` (hill model detection, smooth normals; original faces wind clockwise), `hillMaterial.ts` (TSL: gamma-lifted palette colour, slope/altitude/noise rock blend, fake bounce light via emissive), `scatter.ts` (seeded rocks + bushes on up-facing hill triangles, cap 2500). Wired into `zoneScene.ts` (hill faces go to their own 'hills' mesh) and `zoneOverrides.ts` (loads scatter models when the zone has hills).
- New `public/models/nature/scatter_rock{1,2,3}.glb` (Quaternius Rock_Medium, via `art/jobs/scatter-rocks.json`), manifest entries. Bushes reuse bush1/2/4/fern. Tests: `hillMesh.test.ts`, `scatter.test.ts`.
- Screenshots: `shots/local/3/before-*.png` vs `after-*.png`, `hill-a/c.png`, `zone6.png`; 60 fps in zones 1, 3, 6.
- Limitations: rocks on very steep faces can look stuck on rather than sitting; scatter is not culled by distance (instanced, cheap); snow-white palette faces in zone 6 keep their colour. Shaded sides rely on `HILL_BOUNCE` because scene ambient is weak: Opus may prefer fixing ambient globally.

## Item 4 (partly done; road material/ruts moved to Opus)
- Verge grass: `GroundSampler.verge` (grassGround.ts, road/path mask within 1.6 units) makes `scatterCell` add 1.6x extra clumps, 1.35x larger, only beside roads.
- Roadside stones: `roadStones.ts` (seeded, per road-edge cell), 4 models `scatter_stone1-4.glb` from Quaternius RockPath pieces (`art/jobs/scatter-stones.json`), added in `zoneHost.ts` as 32-unit chunks distance-culled at 60 units (`perf.ts` chunk info gained optional `far`).
- Also: hill rock colour darkened a touch, hill rocks sink deeper (floating look). Tests: `roadStones.test.ts`, verge case in `grassMath.test.ts`.
- Screenshots `shots/local/4/after-*.png`, 60 fps. Not done: road-edge blend band in roadMaterial (Opus).

## Item 5: props
- New `tools/blender/build_props.py` + `art/jobs/props-outdoor.json`: builds fitted-to-box GLBs from Medieval Village/Nature kit pieces plus a few primitives (fence = 5 kit panels, chest/box = kit crate, well = brick ring + beams + roof, rockpile/rockslab = nature rocks, fireold = stone ring with logs, dirtpile and stump = flat-coloured primitives).
- New `public/models/props/*.glb` (chest also used for `chest_nl` and `box`), manifest entries. No code changes: the existing override path handles both mesh and sprite models.
- Screenshots `shots/local/5/*.png` (chest-close, fire-close, after-well, after-fence), 60 fps.
- Limitations: well is 7.5k polys (5 per zone, fine); stump/dirtpile are plain colours (no texture); chest and fence sit on the ground rather than half-buried like the originals; not yet checked in zones 3-12; the whole list of props still missing is under Questions for Reuben.
- Noticed, not touched (out of my file scope): hill-scatter bushes look black at distance (no ambient on their glb material).

## Item 6: bodies
- New `tools/blender/build_bodies.py` + `art/jobs/bodies.json`: imports a Modular Outfit (+ hood), the Universal Base Character (head/hands), hair and eyebrows, binds the Death01 action (last frame) from the Universal Animation Library to every armature (they share one 65-bone rig; Blender 5 needs the action slot set), bakes the pose, lays it along X, fits `length`, decimates to ~0.2, keeps base-colour textures only, exports static GLB.
- New `public/models/props/{dbody1,dbody2,rogebody,morhbody}.glb` (6-9k tris, 0.4-1.2 MB each) and manifest entries; `CREDITS.md` gained the three Quaternius packs.
- Mapping (my guess, tell me if you want others): dbody1 male peasant, dbody2 male ranger with hood, rogebody female ranger with hood, morhbody female peasant with long hair. Variety via mirror/yaw only (one death pose exists).
- Screenshots `shots/local/6/after-close.png`, `after-dbody2.png`, `after-dbody1.png`, 60 fps. Preview renders `shots/body-*.png`.
- Limitations: `deadbug` (zone 9 monster) not done; all corpses lie face down in the same pose; morhbody is not visibly a Moredhel (no elf ears/dark skin in the kit); bodies are lit like props (no ground shadow tweak). Files are the largest assets in `public/` so far.

## Bodies, clothing pass (follow-up to item 6)
- `build_bodies.py` gained per-part `tints` (keeps the outfit texture's light/dark pattern, replaces its colour, one copy per part), bypasses the rangers' painted vertex-colour multiply (it made them black), deletes base-character skin under the clothes (decimation let it poke through), drops skin weights and spare UV sets, textures 256 px.
- Matched to the original sprites (`art/reference/Z01/slots-4x/16.png` etc.): dbody2 and morhbody = purple hooded cloak, grey legs, brown boots (Moredhel; morhbody mirrored/yawed); dbody1 = green tunic, red-brown legs; rogebody = brown hooded leathers.
- Sizes: dbody1 283 KB, others ~384 KB (were 0.4-1.2 MB). Screenshot `shots/local/9/start-body.png` (chapter 1 start body, zone 1). 57-58 fps there, but the 371k tris come from the new hill detail, not the bodies (6k tris each).
- Known: no Moredhel ears or skin tone; the cloak is a tinted ranger body, so it keeps ranger straps.

## Props from the Fantasy Props MegaKit
- Kit unpacked to `art/incoming/fantasy-props-megakit/` (gitignored). It has no tents, gravestones or signs (94 pieces: furniture, barrels, chests, market stalls, books, bottles...).
- `build_props.py` now takes `<jobs.json> <kit dirs...>`; new types `chest` (kit `Chest_Wood`, textured, 2.5k tris, replaces the crate for `chest`, `chest_nl`, `box`), `tent` (canvas A-frame prism, flat colours, 22 polys), `gravestone` variants 0-4 (rounded, cross, block, tall slab, broken; flat stone with a moss mound). Jobs in `art/jobs/props-camp-graves.json`; models `public/models/props/{chest,tent,tstone1-5,tmbstone}.glb`; manifest entries added. Rig widget meshes ("Icosphere") are skipped when importing kit pieces.
- Screenshots `shots/local/10/graves.png` (zone 1 graveyard), `tent.png` (zone 6), 60 fps.
- Left as sprites: `sign1-4`, `signpost` (painted symbols would be lost). The tent is plain and boxy: a real tent model would be better. Gravestones are blank (no carving).

## Round 3, item 1: signs and other remaining props (zones 1-9)
- `build_props.py` new types: signboard (`sign1`, `signpost`), waymark (`sign2-4`: the originals are carved stone markers, not wooden signs), scarecrow, rope, column, marker/slab (rocks), catapult (beams, 4 wheels, A-frame, arm, bucket, kit crate counterweight, fitted to 16.4x13.8x10.2). Jobs: `art/jobs/props-signs-misc.json`; also `bush3`/`bush5` as sprite replacements from nature-kit bushes (`art/jobs/bushes-sprites.json`). Manifest updated.
- Screenshots `shots/local/11/before-*` / `after-*` (catapult zone 6, waymark zone 2, column zone 9, scarecrow zone 6), 60 fps.
- Still sprites/palette: `trap`, `engine` (zone 6), `deadbug`, `cryst*` (zone 9 crystals, palette meshes), `corn`, `db*` (decals), `entrance`, `invis`. The waymarks and signs lose the original painted glyphs; `well` was already a model.
- The Fantasy Props kit has no wooden sign boards, so signs are built shapes.

## Round 3, item 2: scatter boulder material
- New `src/render/scatterRockMaterial.ts`: one shared node material (grey-brown banded stone, lichen on upward faces, bounce emissive so shadowed sides stay readable), applied to `scatter_rock1-3` in `zoneScene.ts`'s placement loop (3-line change; hillMaterial.ts untouched).
- I could not frame a close boulder in the new hill layout (scatter is sparse now), so the look is unverified in game; check near hills. Roadside stones are separate and unchanged.

## Round 3, item 3: HD town scenes (pipeline done, NOT verifiable yet)
- Scene pictures are composed at load time (`composeScene`), so replacements are keyed by a hash of the composed pixels: `src/game/sceneHd.ts` (`sceneHash`, `loadSceneHd`, served from `/art/scenes-4x/<hash>.png`; dev server serves `art/reference`), hooked in `townHost.ts` only (`load` fetches the HD image, `show` passes it as the picture). Drawing and hotspot code untouched; falls back to the 320x200 picture when no file exists.
- `scripts/export-town-scenes.ts` writes every distinct composed scene (117 scenes x 9 chapters) to `art/derived/scenes/<hash>.png`, for `tools/upscale/upscale.py art/derived/scenes art/reference/scenes-4x`.
- Blocked: every scene currently composes to the same all-black image (the bug the cloud is fixing), so the export gives 1 file. After that fix: rerun the export, run the upscaler, check a scene in game. Tests cover hash/URL only.

## Round 4, item 1: dark shape on the zone 1 hill
- It was a scattered fern/bush (nature-kit materials go near-black in shade). `scatterRockMaterial.ts` now gives scatter bushes (`bush1/2/4`, `fern`) a cached bounce-lit copy of their material (emissive = own colour x 0.45). `shots/local/13/blob.png` (before) vs `blob3.png` (after: green). fps there is 42-43 both before and after (water/hills, not this change).

## Round 4, item 2: last sprites/palette props
- New builders in `tools/blender/props_last.py` (hooked into `build_props.py`): `crystal` (cluster of 3-6 hexagonal shards with pointed tips, emissive in the crystal's own colour; the 13 `cryst*` models, colours from the original palettes: blues, purple, cyan, amber, smoky white), `corn` (5-stalk golden clump with leaves and cobs), `carcass` (`trap`: dead stag with antlers and a snare ring), `engine` (hide-hung wooden siege tower, 6.8 x 8.4), `beetle` (`deadbug`). Jobs `art/jobs/props-last-sprites.json`, 17 models, manifest updated.
- Screenshots `shots/local/13/{cryst,corn,bug,engine}.png`: zone 9 crystal field, zone 1 corn behind the fence, 60 fps.
- Crystal footprints come out ~20-30% wider than the original boxes (fit uses vertex bounds before joining); heights match. Whites glow quite bright.
- `entrance` skipped on purpose: it is not a prop but a landscape piece (a big hill/canyon wedge with black faces at the zone 1/2/6 town entrances: `shots/local/13/entrance.png`, from zone 1 x=646400 y=855000). It belongs with the hill meshes (`isHillModel` does not include it), so I left it for you.

## Round 4, item 3: tree variety
- Finding: the tree sprites are the same in zones 1-5 and 7 (only the zone 6 set is recoloured, cold blue-grey; zone 8 has dark ferns and groves; zones 5/7 add darker pines, slots 35-38), so a per-zone model mix would not match the originals. Instead every plant instance now varies and each zone gets a foliage tint.
- New `src/render/treeStyle.ts`: `styleInstances(zone, placements)` gives each tree/grove/fern/bush a height (+-22%), width, brightness (+-14%) and a small warm/cool shift, hashed from its position (stable between loads), times `ZONE_FOLIAGE[zone]` (zone 5 and 7 slightly darker, 6 cold blue, 8 dark); `applyInstanceColors` writes them as per-instance colours. Wired into the placement loop in `zoneScene.ts` (5 lines). Tests: `treeStyle.test.ts`.
- Screenshots `shots/local/14/{z5,z6,z1,z8}.png`; 60 fps in zones 1, 5, 6 and 8 (no extra draw calls, one instance-colour buffer per mesh).
- Limits: the tint is subtle on the frost zone; the kit models are the same ones as before (no extra species added), so the mix of species per zone is unchanged. The bounce-lit scatter bush material ignores the instance colour.

## HD town scenes (unblocked by the cloud's scene fix)
- After merging main (town scenes compose again) `scripts/export-town-scenes.ts` finds 101 distinct pictures (117 scenes x 9 chapters); all 101 upscaled 4x (1280x800) with `tools/upscale/upscale.py` into `art/reference/scenes-4x/<hash>.png` (gitignored, like the other upscales; ~15 min on this PC).
- Checked in game: zone 1 x=660800 y=918000 h=192, walk W 5 s to the LaMut prompt, Enter: the town picture draws from the HD file (`shots/local/15-hd.png`), 57-58 fps. Original picture still used when a hash has no file.
- Note for testing: the prompt triggers from y inside 913600-940800 walking east; at y=927000 a new obstacle blocks the walk.
- The scene art only fills the upper ~half of the 320x200 frame (original layout), so the lower half is black.
