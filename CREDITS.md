# Credits

## Third-party art

| Asset | Author | Licence | Used for |
|---|---|---|---|
| [Stylized Nature MegaKit](https://quaternius.itch.io/) | Quaternius | CC0 1.0 | 3D trees and plants (`public/models/nature/`) |
| [Medieval Village MegaKit](https://quaternius.itch.io/) | Quaternius | CC0 1.0 | Building modules assembled into houses, inn and smithy (`public/models/buildings/`) |
| [Universal Base Characters](https://quaternius.itch.io/) | Quaternius | CC0 1.0 | Bodies in `public/models/props/` (posed corpses) |
| [Modular Character Outfits - Fantasy](https://quaternius.itch.io/) | Quaternius | CC0 1.0 | Clothing on the corpses in `public/models/props/` |
| [Universal Animation Library](https://quaternius.itch.io/) | Quaternius | CC0 1.0 | Death pose baked into the corpses in `public/models/props/`; idle pose of the NPC figures in `public/models/npc/` |
| [Universal Animation Library 2](https://quaternius.itch.io/) | Quaternius | CC0 1.0 | Animations of the rigged models |

The rigged, animated party, creature and named-character models (`public/models/party/`, `creatures/`, `named/`)
are built by `tools/blender/build_party.py` from the base characters, the outfits and both animation libraries,
with procedural garments, hair and weapons.

CC0 assets need no attribution; they are credited here anyway, with thanks.

## Original game

Betrayal at Krondor (1993) by Dynamix. No original game data is included in this
repository; the engine reads it from your own installation at runtime.
