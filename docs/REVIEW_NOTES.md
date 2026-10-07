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
