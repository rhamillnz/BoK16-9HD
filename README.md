# BoK16-9HD

A fan remake engine for **Betrayal at Krondor** (Dynamix, 1993) in TypeScript and
WebGPU (three.js `WebGPURenderer`), targeting 2560×1440 16:9 with upgraded graphics.

> **No game assets are included.** You need your own copy of Betrayal at Krondor
> (e.g. from GOG). The engine reads the original data files (`KRONDOR.RMF`,
> `KRONDOR.001`) from your install at runtime.

## Status

- **M1 (done):** resource archive, LZW/LZSS/RLE decompression, palettes, BMX images, browser asset viewer
- **M2 (in progress):** zone model tables, world tiles, terrain; walkable zone 1
- Later: dialogue, party and inventory, combat, chapters, enhanced art

## Running

```sh
npm install
# Point at your install if it isn't the default GOG Galaxy path:
#   PowerShell: $env:BAK_DIR = "D:\Games\Betrayal at Krondor"
npm run dev
```

- Asset viewer: http://localhost:5173/
- Game (work in progress): http://localhost:5173/game.html

```sh
npm test          # unit tests + integration tests against your game data (skipped if absent)
npm run typecheck
```

## Credits

Format knowledge comes from the open-source preservation community, in particular
[xavieran/BaKGL](https://github.com/xavieran/BaKGL) (used as a reference only; no code
copied), [canassa/betrayal-at-krondor](https://github.com/canassa/betrayal-at-krondor)
and [JorisVanEijden/ReverseBak](https://github.com/JorisVanEijden/ReverseBak).

Betrayal at Krondor is a trademark of its respective owners. This project is not
affiliated with or endorsed by them.
