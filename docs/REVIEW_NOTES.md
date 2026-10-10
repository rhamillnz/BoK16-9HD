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
