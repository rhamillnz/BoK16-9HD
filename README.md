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

You need Node.js 20 or newer, a browser with WebGPU (current Chrome or Edge), and your own copy of the game.

```sh
npm install
npm run dev
```

Then open the game at <http://localhost:5173/game.html>. (The asset viewer is at <http://localhost:5173/>.)

### Pointing the game at your BaK install

The dev server reads the original files read-only from your install folder and serves them to the page under `/bak/`. Nothing is copied into this repository. The folder is the one that contains `KRONDOR.RMF` and `KRONDOR.001` (the game also reads `STARTUP.GAM` and the other files from it).

The default is the GOG Galaxy path on Windows, `C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor`. For any other location, set `BAK_DIR` before starting the server:

```sh
# macOS / Linux
BAK_DIR="/path/to/Betrayal at Krondor" npm run dev

# Windows PowerShell
$env:BAK_DIR = "D:\Games\Betrayal at Krondor"; npm run dev

# Windows cmd
set BAK_DIR=D:\Games\Betrayal at Krondor && npm run dev
```

If the page stops with "Game data not found", `BAK_DIR` is wrong or the files are not in that folder (check the spelling and that `KRONDOR.RMF` is directly inside it). Restart `npm run dev` after changing it.

### Standalone build (no dev server)

`npm run build` writes a static site to `dist/` (relative URLs, so any static host or sub-path works; try it with `npm run preview`). Without the dev server there is no `/bak/`, so on first run the game asks for your install folder: **Choose game folder** (File System Access API), or drop the folder on the page, or, in browsers without the picker, the file-input fallback. `KRONDOR.RMF`, `KRONDOR.001`, `STARTUP.GAM`, `*.SX` and `music/*.ogg` are copied into the browser's private storage (OPFS) with a progress bar, and later visits start straight away. Nothing is uploaded. If OPFS is unavailable the files are kept in memory for the session.

URL option: `?resetdata` forgets the cached files and asks for the folder again.

## Controls

The same list is in the game: press **Esc** and choose Options, then Keys.

| Key | What it does |
| --- | --- |
| W A S D or arrow keys | Walk forward and back, turn left and right. W, S, A, D, Shift can be changed in Esc > Options > Rebind movement keys (the arrow keys stay as the second binding) |
| Shift | Run |
| Mouse | Turn the party, when Mouse-look is on in Options (click the game to capture the mouse; Esc releases it) |
| Esc | Open the main menu (new game, continue, load, options); closes any open screen |
| I | Inventory. Arrows or WASD move the selection, E or Tab switches character; Enter or U uses an item, X equips, T gives it to the next character, R repairs |
| C | Character sheet |
| J | Journal: the dialogue lines you have heard, newest first (Up/Down or W/S, PageUp/PageDown, or the mouse); saved with the game |
| Tab | Map and compass (in mines the map shows the overhead tunnel plan) |
| E | Open the chest or container beside you |
| R | Camp and rest in the wild |
| V | Cast a healing or light spell |
| F5 / F9 | Quick save / quick load |
| F6 | Save and load slots |
| M | Music and sound on/off |
| P | Cycle graphics quality (low, medium, high) |

**Gamepad** (any controller with the standard mapping; connect it and press a button): left stick walks and turns, right stick turns, RT runs, A opens/talks (E), X character (C), Y inventory (I), LB cast (V), RB camp (R), Back map (Tab), Start menu (Esc). In menus and screens the d-pad or left stick moves, A confirms, B goes back, LB/RB switch tabs. In combat A is Enter, B defend, X slash, Y shoot, LB wait, RB cast, LT retreat.

**Options** also has Field of view (50 to 100 degrees) and UI scale (60 to 100 percent of the window).

In towns, temples, inns and shops use the mouse: click a hotspot in the scene. Dialogue, shops and chests are also mouse-driven; open screens show their own buttons. Right-click an item in the inventory to use it.

**Combat:** D defend, W wait, S slash, F shoot, C cast, Q retreat, Enter or Space to continue after a fight. The buttons on the combat panel do the same.

**Debug keys:** F3 shows a performance overlay (fps, frame time, draw calls, triangles, plus a scene breakdown: meshes, instances, lights, shadow casters and shadow-pass triangles, grass clumps); `[` and `]` move the clock back or forward 30 minutes; F toggles a free fly camera (click the game to capture the mouse, Space or E rises, Ctrl or Q sinks, Shift is 5x faster).

## URL options

Add these to the game address, for example `http://localhost:5173/game.html?zone=1&post=low`.

| Option | Meaning |
| --- | --- |
| `post=low\|medium\|high` | Graphics quality at start. Overrides the quality saved in Options |
| `grass=off\|low\|medium\|high` | Grass density |
| `zone=N` | Start in zone N at the centre of its first tile |
| `x=` `y=` `h=` | Start position in game units, and an 8-bit heading |
| `song=N` | Play music track N instead of the zone's song |
| `book=C11.BOK` | Show a book chapter on load (cutscene and chapter-transition story pages), e.g. `book=C11.BOK` |
| `cutscene=ADS,TTM` | Play a cutscene on load, e.g. `cutscene=CHAPTER1.ADS,CHAPTER1.TTM` |
| `fov=N` | Camera field of view in degrees for this session. Overrides the Options setting |
| `chapter=N` | Start in chapter N (2 to 9): runs the chapter reset and start script without cutscenes |

## Loading and errors

The game page shows a loading screen with progress while it starts and whenever a zone loads. If startup fails it shows a plain-language error instead of a blank page: game data missing (set `BAK_DIR`), game data that cannot be read, or no graphics support at all. When the browser has no WebGPU the game runs on the WebGL2 fallback and says so in a note at the bottom of the screen for a few seconds. There are no new keys or URL options.

## Saves and settings

Saves go to your browser's IndexedDB (localStorage if that is unavailable), so they stay with that browser and address. Graphics, volume, mute, field of view, UI scale, mouse-look and key bindings are kept in the browser too.

## Development

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
