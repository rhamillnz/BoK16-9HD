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

## Crystal footprints (fixed)
- Cause: `build_props.py` fitted the box by assigning a per-axis scaled `matrix_world` to rotated parts, which Blender turns into shear that it then drops. Now all parts are baked and joined first and the fit is applied to the mesh vertices (`data.transform`). Rebuilt `props-last-sprites.json`: every model now exports at exactly its box (cryst1 3.40 x 3.40 x 10.00, etc.). Zone 9: `shots/local/13/cryst-fit.png`, 58 fps. Other prop jobs (outdoor, camp-graves, signs) were not rebuilt: their rotated parts are few and sizes already matched.

## "Obstacle" on the LaMut approach: none (zone 1, ?x=660800&y=927000&h=192)
- No collision polygon lies within 700 BaK units of (661300, 927000) (checked every clipped item of zone 1 with `placeClip`), and the party controller only collides with polygons, so nothing blocks the party there.
- The walk is just slower than before: holding W for 5 s now gets to x=6616 (and 6613 in an earlier run), holding 12 s reaches x=6624.1 where the LaMut prompt triggers (encounter rect starts at x=662400). The page loads and renders more per frame than this morning (hills, water, scatter), so the first seconds of the hold are spent at low fps. y=918000 still triggered within 5 s because the run there started when the scene was settled.
- So: not a collision, not the entrance wedge, nothing we changed in the world; for scripted tests use `wait:6000` before the hold and hold 12 s.

## Upscaler comparison for the town pictures (for Reuben)
- Weights: only `RealESRGAN_x4plus_anime_6B.pth` was present; fetched the official `RealESRGAN_x4plus.pth` (67 MB, xinntao/Real-ESRGAN v0.1.0) into `tools/upscale/models/` (gitignored). New `tools/upscale/compare_models.py` builds the sheets: `python tools/upscale/compare_models.py town=<hash> ...` (needs `art/derived/scenes` from `scripts/export-town-scenes.ts` and the current 4x in `art/reference/scenes-4x`). The game's HD files are unchanged.
- Each sheet is 3880x850: original (nearest 4x) | anime_6B (current) | x4plus. Also saved: the x4plus result alone, `<name>-x4plus.png`.
- `art/reference/compare/town.png` (LaMut, GDS1A, hash a7c906e9): x4plus keeps the painted texture better: thatch and timber grain survive, the anime model flattens roofs and walls into smooth cartoon shapes.
- `art/reference/compare/shop.png` (GDS1C, 40899e00): x4plus again keeps the floor-plank and brush grain; anime_6B gives cleaner edges on the helmet and bench but looks vector-flat. Close call, slight edge x4plus.
- `art/reference/compare/inn.png` (GDS1B, c589d5df): x4plus keeps the wood-grain and the rough painted faces (anime_6B turns the barrel and the barkeep's face into smooth airbrushed shapes); x4plus is a little noisier in dark areas.
- `art/reference/compare/temple.png` (GDS2D, e34fd734): nearly equal; anime_6B has crisper outlines on the curtains and brazier, x4plus keeps a touch more canvas grain in the wall. Either works.
- My view overall: x4plus keeps the original paintings' texture better in 3 of 4 scenes; anime_6B is cleaner but more cartoonish. If wanted, rerun `tools/upscale/upscale.py ... --model tools/upscale/models/RealESRGAN_x4plus.pth` over the 101 scenes (~15 min).

## Town pictures now x4plus (Reuben's choice)
- Old anime_6B set kept in `art/reference/scenes-4x-anime/` (101 files); `art/reference/scenes-4x/` re-made with `RealESRGAN_x4plus.pth` (101 files, 1280x800). Both gitignored.
- `tools/upscale/upscale.py`: new `SCENE_MODEL` (x4plus); with no `--model` it is used for `--scenes` or when the input folder is `.../derived/scenes`, sprites keep anime_6B. `scripts/export-town-scenes.ts` header shows the command.
- In game (dev server on 5176): LaMut outdoor view (`?zone=1&x=660800&y=918000&h=192`, wait 6 s, hold ArrowUp ~6 s, Enter): `shots/local/16-lamut.png`; inn interior (clicked the LaMut inn hotspot, GDS1B): `shots/local/16-inn.png`. Both draw from the x4plus files, more painted grain than before, ~59 fps.
- Testing note: wait for the HUD fps text before holding the key (otherwise the early keypresses are lost and the party never reaches the prompt); the inn hotspot is at canvas (818, 301) on a 1600x900 window.

## Round 6, item 1: people at NPC dialogue encounters
- `EncounterRunner.npcEncounters()` (plays each Dialog encounter's dialogue on a scratch session, no sounds, and keeps those whose first speaker is an NPC, actor > 6) and `isPending(e)` (flags allow it and it has not fired this chapter); `EncounterMap.all()`. Pure look logic in `src/game/npcLook.ts` (variant from the name's title words, clothing colours sampled from the ACTnnn portrait ignoring skin/dark, placement = centre of the trigger rectangle); `src/render/npcFigures.ts` clones the models, tints the `tint_*` materials, turns each figure to face the party, shows it while pending, keeps it while the party is within 40 units after it fired (so it is there during the dialogue), then removes it. Wired with 12 lines in `main.ts` (one `update` call per frame). `scripts/probe-npcs.ts` lists NPC encounters per zone/chapter (`CH=2 npx vite-node scripts/probe-npcs.ts`).
- Models: `build_bodies.py` got a `stand` mode (height/width fit, `frame` fraction of an action; materials of tinted parts are now named `tint_<part>`); `art/jobs/npcs.json` builds 7 variants (man, woman, guard, noble, monk, moredhel, dwarf) from Idle_Loop; `public/models/npc/*.glb`, 270-365 KB each. CREDITS updated.
- Found: Squire Phillip (zone 1, y=984800), Isaac, Finn; Brother Marc (zone 2), Rowe, Abuk, Mitchel Waylander, Navon, Tamney (zones 3-5). Only dialogues whose first spoken line is an NPC get a figure (9 in chapter 1).
- Screenshots `shots/local/r6/phillip-b.png` (zone 1 x=672000 y=983400 h=0, Squire Phillip facing the party), `marc.png` (Brother Marc, garden, dialogue open), `finn.png` (Finn, dialogue open). 35-39 fps in these spots (no change from the figures: ~5k tris and ~6 draw calls each; zone 1 was already ~35 fps on the hills).
- Limits: figures are the same Quaternius body (no elf ears, dwarf is just a short wide man, no beards); gender and class only come from title words so most named NPCs are "man"; the rectangle centre can be in a field or on a long road line (Phillip's is 26 cells wide); figures are not animated; the portrait tint is crude (dominant colour). Variant `woman` is only used for Lady/Mistress/etc.

## Round 6, item 2: clouds and sunset glow
- `src/render/sky.ts` (dome shader): a procedural cloud layer (4-octave 3D fractal noise on a perspective-projected high plane, so clouds shrink to the horizon; drifts slowly with `time`; thickness thresholded into soft cumulus; shaded by sampling the noise towards the sun, plus a thin bright rim near the sun; the sun's glow shows through thin cloud). Cloud lit/shade colours come from the time-of-day state: sun colour by day (so warm at dusk), horizon/zenith blue-grey at night with a faint moon tint. Only evaluated above the horizon (`If(h > 0.01)`).
- Sunset glow: an orange band along the horizon, strongest towards the sun, strength 0 by day and night (rises as the sun gets within ~0.06 of the horizon, gone below -0.22).
- `skyUniforms.ts`: new `glow` colour; `waterMaterial.ts` adds it to the sky reflection (towards the sun, near the horizon) so water matches the sky; zenith/horizon/sunDir/sunColor/sunVis are still copied as before.
- Screenshots (zone 1, x=672000 y=981500): `shots/local/r6/sky-noon-n.png` (12:00), `sky-dusk-n.png` and `sky-dusk-w.png` (17:30, west), `sky-night-n.png` (22:30); `sky-z5.png` zone 5 at 18:00. 60 fps in zones 1 and 5 (no drop from the shader).
- Limits: clouds are fixed in the sky dome (no parallax), no pitch control in game so only the lower part of the sky is seen; no weather variation (same coverage always); the glow is not in the fog colour so far terrain stays the old horizon colour.

## Round 7, item 1: NPC polish
- (a) Idle: procedural, not a clip. `npcFigures.ts` swaps each model material for a `MeshStandardNodeMaterial` copy whose `positionNode` leans the body side to side (weight shift, up to 5 cm-ish) and breathes the chest (+-1.2% height), both weighted by height squared so the feet stay put; phase per actor so figures are out of sync. Chosen over a skinned Idle_Loop clip because it adds no skeleton/animation data to the GLBs (still 270-360 KB) and no per-frame CPU work. 60 fps at `?zone=1&x=690000&y=981000` (steady state; the HUD reads lower in the first seconds while the zone loads).
- (b) Placement: `npcPlacement(e, roadPoints)` picks the road-edge point (from `roadEdgePoints`, computed once per zone when the figures are built) nearest the trigger rectangle (inside beats outside; ties to the centre), clamped onto the rectangle's cells; no road within 60 units: centre as before. Squire Phillip now stands at the road edge on the east side of his line (`shots/local/r6/r7-phillip.png`) instead of mid-field.
- (c) Variants: dwarf now has a beard (kit `Hair_Beard`). The kit has no pointed ears, so moredhel stays a hooded ranger.
- Tests added for placement. Note: I ran a bare `git stash` once by mistake and restored it at once (apply + drop of my own entry, nothing lost).

## Round 7, item 2: fog follows the sky
- `sky.ts`: `scene.fogNode` = TSL `fog(color, rangeFogFactor(FOG_NEAR, FOG_FAR))` whose colour is the horizon colour plus the sunset glow (same `uGlow` and `towards-the-sun` falloff as the dome band, by view azimuth), so distant terrain takes the glow on the sun side. Same fog range as before; the old `THREE.Fog` stays for its near/far and is used underground (`fogNode` is cleared there and restored outdoors). Zone 1 at 17:30: `shots/local/r6/fog-dusk-w.png` (towards the sun), `fog-dusk-e.png`; 60 fps. By day/night the glow is 0 so the fog is unchanged.

## Round 7, item 3: weather
- `weatherPlan.ts` (pure, tested): presets clear / mist / drizzle / rain as four amounts (rain, overcast, mist, wet) and `scheduledWeather(zone, day, hour, underground)`: seeded hash per zone and six-hour block, ~72% clear, 12% mist, 10% drizzle, 6% rain; zone 6 never rains (mist instead); underground always clear. `weatherUniforms.ts` holds the shared uniforms; `weather.ts` eases them towards the preset (about 3 s) and draws the rain.
- Rain: one static mesh of 7000 quads (28k verts); the vertex shader places and animates every drop in a 26-unit box that wraps in world space around the camera (slight wind, drops nearer than 2.5 units are dropped, the `rain` amount selects how many are drawn), so there is no per-frame CPU work. Hidden when the amount is 0.
- Sky (`sky.ts`): `overcast` flattens the sky to grey, raises cover, turns the clouds dark grey and dims the sun disc, glow and key light (-50% at full overcast via the new `Sky.setOvercast`); fog greys with overcast and, with `mist`, closes to 40% of its far distance. Road (`roadMaterial.ts`): `wet` darkens the surface (more in the ruts) and lowers roughness to 0.32.
- Control: `?weather=clear|mist|drizzle|rain` forces one (applied at once); F8 cycles auto, clear, mist, drizzle, rain; the HUD shows "weather <kind>". Otherwise the schedule uses the game clock (`[ ]` keys move it), zone and underground state.
- Screenshots (`shots/local/r6/`): `wx-rain.png` (zone 1, x=672000 y=981500, forced rain), `wx-mist.png`, `wx-drizzle.png`; `wx-road-*.png` are not useful (no road in frame). 60 fps with rain on at these spots (same as clear; the 41 fps seen at x=655000 is the hill view and equals the clear shot there).
- Not verified visually: the wet road sheen (I could not frame a road); it is a darker colour and lower roughness, so the effect will be subtle without an environment map. Rain does not splash on the ground, there is no thunder or rain sound, and weather is not saved.

## Round 8, item 1: hill performance (no change made: no hot spot found)
- The 41 fps I reported at zone 1 x=655000 was the HUD read during the first seconds (zone still loading, headless with vsync). Measured properly with `scripts/profile-view.mjs` (new: Chromium with the frame-rate limit and vsync off, F3 overlay after 9 s): zone 1 hill view (x=655000 y=918000 h=192) 107 fps / 9.4 ms; zone 1 open view 111 fps / 9.0 ms; zone 3 overview 111 fps / 9.0 ms; zone 5 overview 118 fps / 8.5 ms. All are at the 60 fps cap with ~2x headroom on this GPU.
- Experiments at the hill spot: hills `castShadow = false`: 112 fps (-0.5 ms); hills `visible = false`: 112 fps (8.9 ms). So the ~650k-triangle merged hill mesh costs about 0.5 ms in the main pass and nothing measurable in the shadow pass here; the 9 ms floor is elsewhere (not hills). The F3 "shadow-pass tris" (24M) counts every caster whole, it is not what the GPU draws.
- So I did not split the hills into chunks / LODs: it would add risk to the near look for no gain on this PC. If a weaker GPU shows hill cost, the plan is per-item chunks (items do not share vertices, so no cracks) with near/far `detailHill` options and `castShadow` off for the far level. Tell me if you want it anyway, or want the 9 ms floor profiled (post-processing, grass or CPU).

## Round 8, item 2: rain and wind audio
- New `src/audio/ambience.ts` (`WeatherAmbience`, `ambienceLevels`, tested): synthesised in WebAudio, so there are no sound files and nothing to credit or license. Rain: looping 3 s noise through high-pass 700 Hz / low-pass 8 kHz, gain = rain amount x 0.22. Wind: looping dull noise through a 380 Hz band-pass whose gain and pitch drift slowly (two LFOs), gain from overcast/mist (and a little from rain) x 0.16. Silent underground. Gains ease with `setTargetAtTime`. Own AudioContext, resumed on the first click or key (like the music).
- Wired in `main.ts` (3 lines): updated every frame from `Weather.amounts`; M mutes it together with the music (`ambience.setMuted(music.isMuted)`). It does not go through `sfxBus` (that is for frp.sx effect ids), and the music player's volume setting does not scale it.
- I could not listen to it (headless): no console errors with `?weather=rain` and M pressed. Please judge the sound; the levels are `RAIN_MAX` / `WIND_MAX`. I chose synthesis because I have no verified CC0 files here; if you prefer samples, drop two small ogg loops in `public/audio/` and I will swap the sources (credit in CREDITS.md).

## Round 9: denser hill foliage, scree, small pines
- `scatter.ts` rewritten, `zoneScene.ts` scatter call only. Ground cover (`bush4`, `fern`) and shrubs (`bush1/2/3/5`) now sit in clumps: a hashed clump field (7-unit cells, 55 % hold a clump, radius ~2-4.5) gates candidates, with a 6 % floor between clumps; bigger plants in the middle of a clump. Plants only where normal.y >= 0.75 (ledges, tops). `bush3` (red berries) is half weight because it reads loud.
- Pines: `tree4a`/`tree6a` at 0.5-0.8 scale, only on flat tiles (normal.y >= 0.93) at least 4 units above their hill's foot and inside >= 60 sq units of flat area per 32-unit cell/1.5-unit height band, 0.01 per sq unit.
- Scree: faces with normal.y < 0.5 (spec said 0.35; the big front faces in zone 1 sit at 0.4-0.5 and got nothing) within 2 units above the local foot (lowest hill vertex in the 3x3 8-unit cells), boulders x3 weight plus `scatter_stone1-4` and `rockpile`, pushed 0.3-1.7 out from the wall, scale 0.35-1.15.
- Counts: reservoir sampling per category so a zone with ~1M hill triangles never builds a million matrices. Caps: cover 120k, shrubs 24k, pines 400, rocks 6k, scree 24k (180k total). Instances are split into 360-unit ground cells with distance culling (cover 230, scree 300, shrubs 380, rocks/pines 800 units) via the existing `userData.chunk` path, so only nearby cells draw. Cover, shrubs and stones do not cast shadows (they only cost shadow-pass time).
- Perf, `profile-view.mjs`, F3, 15 s after load, 1600x900: (690000,1060000,h100) before ~105-130 fps / 257 meshes / 17.9k visible instances, after 86-92 fps / 467 meshes / 25k; (700000,1050000,h128) before ~105-131 fps / 240 meshes / 17.5k, after 85-92 fps / 452 meshes / 24.7k. Frame time is now mostly draw calls (chunk x model x sub-mesh); bigger cells or a smaller cull distance buy fps back. Run-to-run GPU noise here is about +-15 fps.
- Screenshots: `shots/foliage/before-*.png` / `after-*.png` (`hillA` = x=720000 y=1040000 h=60, `hillB` = x=672000 y=1030000 h=200, plus the two requested views, which look at flat ground and show little hill).
- Not sure about: red bushes still read strongly on pale hills; a few shrubs and boulders sit on steep faces (existing rock lean logic); foot detection uses the lowest hill vertex nearby, so a hill on higher ground next to a lower one gets scree/pines judged against the lower foot.

## Prop review round 2 (Opus, 2026-10-14)

- Reuben reviewed all 44 remade props in zones 3-12 (artifact page) and asked for changes; this round applies them.
- New `tools/blender/props_detail.py`: textured builders (kit stone/wood/bark crops, generated pseudo-script inscriptions, tree rings, dirt and cloth tiles) replace the flat-colour gravestone, waymark, signboard, column, stump, dirtpile, scarecrow, rope, carcass and beetle builders, plus new tomb, molehill, ropepost and boxtrap types. Jobs moved to `art/jobs/props-review2.json`.
- `build_props.py`: `"fit": "height"` keeps proportions; a negative box zmin buries the foot (nothing floats on grass).
- `build_bodies.py`: `sink` lowers corpses into the grass; dbody2 drops forearm skin under its sleeves and is less decimated.
- `build_house.py`: `fit: keep`, `woodgrid_ground`, `windows: thin`, tower `cross`, and `extras` (kit pieces, forge, inn sign) placed after fitting; extra kit dirs on the command line. House is now a one-storey cottage, inn bigger and half-timbered with a sign, blacksmith has a forge yard, church has a bell tower and spire, temple is all stone. Catapult at 80%.
- Checked in game (zones 3-11) and in a three.js portal with an in-game-size person. Open question to Reuben: small props are 2-3x a person's size at the original scale.

## Prop review round 3 (Opus, 2026-10-14)

- Reuben asked for human-sized props to suit a person (in-game person is ~1.3 render units): graves, tomb, signs, waystones, bodies (1.35 long), scarecrow, trap, tent, chests, stump, dirt pile, rope post, well, campfire shrunk via the job boxes; fence and corn only lowered (they tile in rows/fields).
- `build_house.py`: roofs are now `props_detail.tile_roof`/`tile_pyramid` (kit tile texture + normal map, ~0.28 m tiles; the kit roof meshes had very large modelled tiles), pitched to the kit gable pieces; chimneys stretched to clear the roof by ~1 m; `wall_layout()` keeps walls symmetric, centres doors on even walls (neighbours stretched), and gives 2-module tower walls one centred double-width door/window; `shutters` option; `extras` kit pieces stand on the ground (the inn banner was half buried). House and inn lose the lattice panels.
- New builders in `props_detail.py`: `catapult` (torsion mangonel, half the old size), `siegeshed` (Roman musculus with thatch and wattle, replaces `engine`), `temple` (Greek peristyle temple with terracotta roof and altar, replaces the kit temple job).

## Prop review round 4 (Opus, 2026-10-15)

- Reuben passed 28 of the 44 props; this round fixes the 16 with notes.
- `build_bodies.py`: tints skip the outfits' skin material (`MI_Regular_*`), so bare forearms and hands stay skin-coloured; when an outfit has an arms piece the base character's forearms and hands are dropped (the two skins overlapped as patchy half-and-half arms); new `gloves` option paints hand and finger faces one colour (dbody2 and morhbody wear black gloves; morhbody's clothes are grey).
- `props_detail.py`: `carve_writing()` lays pseudo-script on a stone's own faces as an alpha-masked decal (glTF MASK), so nothing stands proud; used for the milestone (sign3) and, via `build_props.build_marker` `"writing": true`, the waymarker rock (centred on its biggest facet each side). Signboards are one arrow-shaped plank (`arrow_board`) instead of a board plus a loose triangle. Column and leaning gravestone lose the grey "chip" boxes. Stump top shows pale ringed wood (the bark rim was covering it). Beetle is matte with textured chitin, wing-case ridges, breathing holes, eyes, beaded antennae, jointed legs with claws, and a torn-off leg. Siege shed: the back "wall" was a rotated box sticking out through the ram; it is now two wattle doors hinged at the corners and opened outwards. New `rockheap` (rockpile: faceted heap in the kit rock material with kit rocks bedded in, shaped like the dirt pile; decimated to ~1.6k tris because hill scree scatters it) and `shack` (rift shack: lean-to with board walls, single sloping roof, door, shuttered window, woodpile; two thirds of the old size).
- `build_props.py`: `decimate` job option. `props_last.py`: corn has seven plants and smaller leaves.
- `build_house.py`: 2-module tower walls get a normal-size centred window with half-width wall either side (church belfry, now `thin` like the nave); new `banner` extra (freestanding pole on a footing with the kit cloth) replaces the inn's wall-bracket banner whose post floated.

## Party combat models, round 1 (Opus, 2026-10-15)
- `tools/blender/build_party.py` + `art/jobs/party.json` build rigged, animated GLBs for Locklear, Gorath, Owyn, Pug, James and Patrus into `public/models/party/` (CC0 kit art only). References: the original dialogue portraits (ACT001-006) and combat sprites (LOK1, GOR1, OWN1, PUG1, JIM1, PAT1 BMX).
- Each is a Modular Outfits outfit on the shared 65-bone rig, the base character's head, kit hair (Hair_Long over Hair_Buzzed for long hair; the beard trimmed to a moustache or goatee), tints per part, and procedural garments skinned to the same bones: breastplate (a smoothed shell of the shirt, pushed clear of it, cut with planes, raised rim and rivets), pauldrons, robe (shell plus a skirt weighted from pelvis to both legs), cape, collar, cap, baldric, scarf, belt and scabbard. The weapon is parented to `hand_r`; its rest direction is solved so it points forward in the attack lunge (`aim`).
- Clips (glTF animations, one NLA track each): idle Sword_Idle, walk Walk_Loop, attack Sword_Attack, block Sword_Block, cast Spell_Simple_Shoot, shoot Pistol_Shoot, hit Hit_Chest, death Death01 (UAL1/UAL2).
- In combat (`src/render/fighterModels.ts`, `CombatView`): party members with a model replace their billboard once it loads, sized to their original combat sprite's height; they walk move paths cell by cell, face whoever they act on, play attack/shoot/cast/block, flinch or fall when struck, and the fallen stay lying on the field.

## Party combat models, round 2 (Opus, 2026-10-15)

From the user's round-1 notes (portal collection `party1`). Round 2 verdicts go to `party2`.

- **Fitted garments.** Cuirass, pauldron lames, belts, collars, the baldric and Owyn's V collar are now grids of rays cast from outside onto the rest-pose body (`Caster`, `fit_shell` in tools/blender/build_party.py). They follow the body with an even gap. A one-way envelope bridges laces and folds, and boundary smoothing removes the grid's stair-steps. Rolled rims are tubes along the open edges.
- **Weights.** Garments take skin weights from the body. Two fixes were needed:
  - The top of each pauldron stays on the clavicle; with skin weights it swung up like a fin when the arm dropped.
  - A vertex whose nearby body vertices all use filtered-out bones (the Ranger's cowl is skinned to the head) now searches further, then falls back to spine_03. Unweighted vertices had stayed put while the body moved, which made the fins behind Gorath's head.
- **Grip.** The weapon goes in the closed right fist, measured from the finger bones in the idle clip and carried back to the rest pose through the hand bone. HOLD slides the weapon so the middle of the grip sits in the fist.
- **Hair.** Generated over the scalp and hung straight down from the widest point of the head. It has a per-azimuth hairline, strand grooves and texture, ragged ends, an optional ponytail and grey temples. Used for Locklear, Owyn, Pug and James; Gorath and Patrus keep the kit hair.
- **Per character:**
  - Locklear and James have rapiers and slim scabbards.
  - Gorath has gold filigree on dark steel, a wolf's-head relief on the chest and pauldrons, a collar standing on the armour, and a cape cast clear of the legs, belt and scabbard (it sweeps back and follows the thighs a little). There is a chained version, `gorath_chained.glb`, not used in combat yet.
  - Owyn has a long tunic and a red V collar.
  - Pug has a black robe with brown trim.
  - Patrus's robe reaches the ground and follows the legs.
  - Eyebrows are thinned (`brow_scale`).
- **Known rough edges:**
  - Staff users still use the sword clips, so the staff is levelled like a sword. Idle_Torch_Loop was tried and looked worse: the left hand is raised and empty.
  - James's grey temples are a flat patch.
  - The tunic skirt reads a little like an apron.
  - Triangle counts are 29k–119k: Locklear, Gorath and chained Gorath are heavy.

## Party combat models, round 3 (Opus, 2026-10-15)

From the round-2 notes (collection `party2`); round 3 verdicts go to `party3`.

- **Weapons.** They pointed backwards: the fist axis now runs from the little finger to the index finger again, so the blade comes out of the thumb side. HOLD keeps the grip in the fist.
- **Belts.**
  - The default height is now 1.06, and the back is 3 cm higher than the front, so the belt sits over the hips instead of sagging over the seat.
  - Only 2 envelope passes and a 3 mm gap make it tighter.
  - Owyn has no added belt (the outfit's own fits).
  - Robe skirts start at the belt and their top ring is cast onto the robe's top, so the two halves join and the kit belt underneath is hidden.
- **Torso fits.** They now cast against every outfit mesh with "_Body" in the name (`torso_parts`), so the Ranger's separate belts and pouches stay under Gorath's armour.
- **Cloth.** All materials are double-sided, so looking into a collar shows the cloth's inside instead of through the character.
- **Hair.**
  - Long hair lies over the shoulders (cast at each height and pushed out).
  - Hits more than 7 cm beyond the head are ignored: they are the rest pose's horizontal sleeves and made "wings".
  - A `wave` option. The hood clamps its reach for the same reason.
- **New garments and trims.**
  - The `knit` hair mode is a woolly cap (rib texture, rolled cuff) for Patrus.
  - `hood` lies down on the back.
  - The `close` beard trim pulls the kit beard towards the skin (`hug_surface`) for James and Pug.
- **Chained Gorath.** No weapon; the manacles keep one ring each; the body chain sits 3 cm proud of the armour.
- **Animations.** The pistol "shoot" clip is gone from models and the portal; a crossbow shot plays the attack.

## Party round 4 and creatures round 1 (Opus, 2026-10-15)

**Party, from the round-3 notes (`party3`; round 4 verdicts go to `party4`):**
- **Hollow outfits.** A filler torso (the base body's chest, back, shoulders and neck base, `torso_only`) sits inside every outfit. It is sunk 4.5 cm along the normals (the base body is bulkier than the outfits) and only 1.8 cm at the neck, where it meets the head.
- **Gorath.** Generated long hair replaces the kit's long hair, which was bald on top.
- **Chained Gorath (`shackled`).** IK solves both arms so the hands meet in front of the belly. The collarbones, upper arms, forearms and hands are then held at that pose in every clip (`shackle_pose`), so the hands keep their place relative to the chest. Manacles and a sagging chain between the wrists are pinned to spine_03.
- **Hair.** It drapes over the shoulders by casting from just beyond them (0.26 m), past the rest pose's sleeves.
- **Robes.** They follow the legs fully at the hem, and robed characters drop their Feet: boots poked through floor-length robes in every stance.
- **James.** The buckle is seated on the strap, the ponytail is shorter, and the tunic tint is near-full, so the Ranger texture's pale patches no longer show.

**Creatures (`art/jobs/creatures.json`, generated by `tools/blender/make_creature_jobs.py`):**
- 19 humanoid monsters on the party's rig and clips, one per BNAMES sprite set. Monster numbers map to models in `creatureModelName`.
- **New build options:**
  - `outfit: null` for bare-bodied creatures (the base body split at the neck into Head and Base_Body).
  - `proportions` (bones scaled in pose and applied as the rest pose; the clips only rotate bones, so they still fit).
  - `skin_texture` (stone, hide or scales), `elf_ears`, `alpha` (see-through; also written as a rig extra that the game applies, because the exporter drops alpha on textured materials).
  - Weapons: axe, spear, club, mace, flail, dagger.
  - Garments: mask, loincloth, seaweed, fangs, hood, cloth-hair (cowls and bandanas), ragged hems.
- **Not yet built:** the non-humanoid monsters: scorpion, spider, the wyverns, beasthound, Nethermander, Dread, Wind Elemental, Servitor of Lims-Kragma. They keep their sprites.
- **Compression.** All models are Draco-compressed, which takes them from about 80 MB to 22 MB. The decoder is copied into public/draco/ (three's draco_wasm_wrapper.js, draco_decoder.wasm and draco_decoder.js; the gltf/ subset lacks the wrapper).
- **Debug option.** `?monsters=18,48,19` replaces every fight's enemies, in turn, to view creatures in any fight.

## Party round 5 and creatures round 2 (Opus, 2026-10-15)

From `party4` and `creatures1`; the next verdicts go to `party5` and `creatures2`.

**Shared fixes:**
- **Torso fill.** It is now only the neck, collarbones and top of the chest and back (down to 14 cm below the neck base). It meets the neck with a 2 mm inset and sinks inside the cloth below. The full filler poked "ribs and shoulder blades" through the Ranger shirt (James, Nighthawk).
- **Robes.** They end at the ankle (hem 0.13) with the feet kept: the user read dropped feet as missing legs.
- **Hoods.** A `cowl` mode hugs the back of the head and neck, then lies on the shoulders at a cloth's thickness (cast at each height). Before, it hung as a cylinder from the head's widest point.
- **Hair.** It stops above the shoulders for Owyn, Pug, the Moredhel spellcaster and the rogue mage: long hair rigid on the head clips the shoulders in the clips.
- **Proportions.** Bones no longer inherit their parents' scale while proportions are applied. A short, wide neck squashed the head into a mushroom (ogre, Brak-Nurr).
- **Face sculpting (`sculpt`).** Ops: brow, slope, nose, jaw, snout, chin, cheeks, crown, lumps; landmarks come from the nose tip. It fades out below 1.58 m so the head and body seam doesn't crack. `warts` adds face bumps, `fangs` takes a radius for tusks, and there is a new scimitar weapon.

**Per model:**
- Gorath has grey hair; the chained Gorath's hands are 36 cm apart with a longer sagging chain.
- Rebuilt: the goblin (small, green-brown hide, big head and nose, ears, tusks, fuzz) and the ogre (huge, grey-green hide, brow, tusks).
- Brak-Nurr is square, with thick legs and a lumpy head. The giant has a Neanderthal face and wild hair off the forehead. The troll is bald with a higher loincloth.
- The pirate has a scimitar and blue-grey cloth. The Panth Tiandn is unarmed. The Pantathians have snouts.
- Makala is hooded, with Tsurani skin. The witch has a hooked nose, a pointed chin and warts. The Rusalki has legs.

## Party round 6 and creatures round 3 (Opus, 2026-10-15)

Approved: Locklear, Gorath (both versions), Owyn, Patrus, and 12 of the creatures. The next verdicts go to `party6` and `creatures3`.

- **Bare-bodied creatures.** They keep the whole body as one mesh. The neck split showed as a seam, and the heads looked like they floated. `Head` is now a helper copy, used for casting and hair and deleted before export. Sculpting and ears apply to the whole body.
- **Belts and loincloths.** They follow `waist_shift`, the pelvis moving under `proportions`. The loincloth flares from the hips it hangs from (`flare_scale`) and follows the legs fully.
- **Torso filler.** It settles 4 mm inside the nearest outfit cloth wherever it would show through or touch, and keeps its place at open collars. This closed James's neck gap.
- **Hair options.** `smooth` hair has no grooves or fringe (James's hair pulled back). `peak` gives a cowl a magician's point (Pug).
- **Snout.** It is smaller and rounder (Pantathians).
- **Makala.** Hood only, with a black-grey beard.
- **Brak-Nurr.** Thinner thighs, thicker calves, bigger feet.

## Party round 7 and creatures round 4 (Opus, 2026-10-15)

The next verdicts go to `party7` and `creatures4`. The rogue was marked "work" with no note; it is unchanged pending one.

- **Loincloth back panel.** `skirt(back=...)` hangs the rear panel lower and further out; the loincloth flares 1.3x from the hips. This covers the seat on the goblin, ogre, troll and giant.
- **Fallen hood.** `g_hood` is now a collar round the back of the neck that falls into a pointed pouch between the shoulder blades (Pug: one hood, down).
- **Smash attack.** `smash_clip` builds a two-handed overhead smash from IK poses (`ik_arms`) on a copy of the idle, for the Brak-Nurr. No kit clip lifts both hands over the head together.
- **Claw attacks.** The Rusalki and Shade attack with Zombie_Scratch (two-handed claw); the Shade also gets the zombie idle and walk.
- **Black Slayer.** Pale grey hide skin, a light close beard, hollow cheeks.
- **Gorath.** Hair to below the ears. The chained version holds its hands 42 cm forward and 44 cm apart, with a shallower chain sag.
- **Locklear.** The rapier scabbard is shorter (0.8) and swept back.
- **Patrus.** The robe is wider at the hem and ends at 0.17.

## Party round 8 and creatures round 5 (Opus, 2026-10-15; not yet on the review pages)

- **Loincloths.** A fitted hide wrap (shell of the body over hips and thighs, keeping skin weights) under the ragged flaps.
- **Manacles.** They ring the wrists around the forearm axis; the chain hangs from the cuffs' undersides.
- **Brak-Nurr smash.** It ends at belly height with bent elbows.
- **Black Slayer.** White eyes (`eye_color`).
- **Nighthawk.** A closer cowl, a mask up to the eyes, a high collar, and a black torso filler (`fill_color`).
- **Moredhel spellcaster.** Leather outfit, bearskin cape and fur collar (`fur`).
- **Next.** The non-human creatures (scorpion, spider, wyverns, beasthound, Nethermander, Dread, Wind Elemental, Servitor) are not started.

## Non-human creatures, round 1 (Opus, 2026-10-16)

`tools/blender/build_beasts.py` builds the creatures no kit has: scorpion, spider, Servitor, beasthound, Nethermander and wyvern. Run it as `blender ... build_beasts.py -- public/models/creatures shots/beasts [name ...]`.

- **Rigs.** Each creature is a function building a skeleton (the root bone is `pivot`; `root.position` tracks are stripped by the loader).
- **Bodies.**
  - Metaball groups converted to meshes, with each element radius scaled 1.6x so the visible surface matches the given radius.
  - Tubes for legs, tails and struts; rigid pieces for claws, teeth, eyes and stingers; a sheet for the wing membranes.
  - Skinned by distance to the allowed bones' segments (inverse fourth power, best three).
- **Animations.** Written as rotations about rest-pose world axes and converted per bone, keyed every other frame for every bone. Clips: idle, walk, attack (also cast), block, hit and death; deaths roll or flip the body with a lift on the pivot.

**Humanoid additions:**
- The Dread and Wind Elemental are humanoids with a new `wings` garment.
- Monster mapping now covers every monster index with a sprite.

**Sizing.**
- Every build writes the model's standing height as a rig extra (`height`). FighterActor scales each model to its combat sprite's height by that, instead of assuming 1.8 m.
- This fixes the giant, ogre and goblin, which were drawn oversized or undersized by their own `scale`.

## Party round 9 and creatures round 6 (Opus, 2026-10-16)

- **Wings.** `leather_image` gives the Dread and Wind Elemental a vein and wrinkle texture, with a fourth finger, tip claws and a rolled edge.
- **Loincloths.** The wrap and flaps now reach the knee, read from the calf bone.
- **Nighthawk.** New `katana` weapon.
- **Chained Gorath.** Hands at belt height; the chain hangs with little sag between the cuffs.
- **James.** Sideburns down to the beard (hairline table); the grey is limited to above the ear.
- **Beasts.**
  - New helpers: `limb` (metaball limbs, or smooth tubes below 5 cm radius, where metaballs bead), `teeth_arc` (teeth seated on the jaw edges), `spikes`, `emissive`, `lava_material` (cracked crust with an emissive crack map).
  - Rebuilt: the beasthound as a Rottweiler (one-piece head, tan markings), the Nethermander in lava red with spines and frill, the scorpion with plates, eyes, mouthparts and serrated claws, and a detailed wyvern.
  - Metaball resolution is 1.8 cm.

## Creatures round 7 (Opus, 2026-10-16)

All 7 party models are approved, and 23 of the 27 creatures. The last four:
- **Beasthound and Nethermander.** The lower jaw is now part of the head's metaball group, skinned to the head and jaw bones, so the mouth opens as one surface instead of a separate floating blob.
- **Scorpion.** The claws are turned over: the hand and fixed finger are on the outside, the moving finger is on the inside (the snap direction is flipped to match).
- **Wyvern.**
  - Black eyes; the nostrils are set into the snout; each horn is a single curved tapered tube.
  - The feet are raised to the ground, with the toes in the leg's metaball group (`limb(extra=...)`).
