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
