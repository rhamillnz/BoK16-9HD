# Review notes (local-art)

## Item 1: remaining buildings (catapult still open)
- `tools/blender/build_house.py`: refactored into `build_part()`; jobs can now have `parts` (main hall + annexes + `kind: "tower"`), `offset`, `skip` (abutting walls), `door_side`. Old single-block jobs unchanged.
- New `art/jobs/buildings-landmarks.json`: church (hall + annex), temple (2-storey hall, two wings, rear tower), illhouse (L-shape), rftshack. Fitted to original bounding boxes exactly.
- New `public/models/buildings/{church,temple,illhouse,rftshack}.glb`, registered in `manifest.json`.
- Screenshots: `shots/local/1/church-a.png`, `church-c.png`, `temple.png` (zone 1), 60 fps. Blender previews in `shots/build-*.png`.
- Limitations: annexes are parallel to the nave (no cross-gables); wing/annex roofs butt into the main roof; illhouse/rftshack not checked in zones 3/9; catapult not done (needs a prop assembly, not a building).
