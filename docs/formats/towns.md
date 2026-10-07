# Town and temple scenes (`GDS*.DAT`, `.TTM`, `.ADS`, `DEF_TOWN.DAT`)

Derived from reading xavieran/BaKGL (`bak/hotspot.cpp`, `bak/encounter/gdsEntry.ipp`, `bak/scene/scene.cpp`, `bak/scene/ads.cpp`, `gui/gdsScene.cpp`, `gui/staticTTM.cpp`, `game/encounterHandler.cpp`) for understanding only; the parsers are `src/formats/gds.ts` and `src/formats/ttm.ts`. All integers little-endian. Items marked *(unverified)* come from BaKGL's own guesses or from our reading and have not been checked against game data here (no game files exist in the cloud; the tests use synthetic fixtures).

A town, temple, inn or shop is a **GDS scene**: a 320x200 picture with clickable rectangles (hotspots). The picture is built from a scene script (`.TTM`) chosen by a scene table (`.ADS`).

## 1. How the world reaches a scene

Two tile-encounter types open scenes: type 6 *town* (table `DEF_TOWN.DAT`) and type 0 *background* (table `DEF_BKGR.DAT`). The encounter's `tableIndex` selects an entry (u32 count, then 22-byte entries):

```
u8[3]  unknown
u8     gdsNumber       town number: the scene file is GDS<gdsNumber><letter>.DAT
u8     letter index    0 and 1 are both 'A', n >= 1 is 'A' + n - 1
u8[2]  unknown
u32    entryDialog     dialogue key asked before entering (0 = none)
u32    exitDialog      dialogue key played when the party leaves (0 = none)
u8     exitCellX       cell offset inside the encounter's tile where the party is placed
u8     exitCellY
u16    exitHeading     high byte = 8-bit heading
u8     walkToDest      1 = animate walking in (not implemented here)
u16    zero
```

Entry flow (BaKGL `EncounterHandler::DoGDSEncounter`): play `entryDialog`, a Yes/No query. "Yes" enters the scene and places the party at the exit position (tile of the encounter + exit cell, `tile * 64000 + cell * 1600 + 800`); anything else puts the party back where it was. With no entry dialogue the scene opens at once. When the party leaves, `exitDialog` plays. The encounter's flags are set as for any encounter.

A dialogue `Teleport` action may also land in a scene: `TELEPORT.DAT` records carry a hotspot (town) number and letter index, see `docs/formats/dialogue.md`.

## 2. GDS scene file

```
u16   length
char[6] resource       scene script base name; scripts are <name>.TTM and <name>.ADS
u8[6] unknown
u8    unknown
u8    templeIndex      bit 0x80 set: a temple, number = low 7 bits
u8[3] unknown
u16   song
u16   unknown
u16   sceneIndex1      ADS scene index of the background layer
u16   unknown
u16   sceneIndex2      ADS scene index of the foreground (NPC) layer
u16   hotspotCount
u32   flavourText      dialogue key of introductory text (0 or 0x10000 = none); not shown yet
u16[4] unknown
hotspot x hotspotCount (36 bytes each)
```

Hotspot:

```
u16 x, y, width, height    rectangle in 320x200 scene pixels
u16 chapterMask            bit n set hides it in chapter n + 1; bit 0x8000 = run when the scene opens
u16 keyword                cursor index + 1
u8  action                 see below
u8  unknown
u16 arg1                   Goto: letter index of the scene to jump to (same town number)
u16 arg2                   ADS scene index shown as the foreground while the dialogue runs (0 = unchanged)
u32 arg3                   dialogue key for a left click (0 and 0x10000 = none)
u32 tooltip                dialogue key for a right click
u32 unknown
u32 dialog                 low word: event-flag pointer, high word: expected value (with checkEventState)
u16 checkEventState        non-zero: availability is the flag test instead of the chapter mask
```

Actions: 2 dialogue, 3 exit, 4 goto, 5 barmaid, 6 shop, 7 inn, 8 container, 9 lute (barding), 0xA repair (2), 0xB teleport (temple teleport), 0xD temple, 0xF end of chapter, 0x10 repair; 0, 1, 0xC, 0xE unknown.

**Availability.** With `checkEventState != 0` and a flag pointer in the low word of `dialog`, the hotspot is available when the flag equals the high word. Otherwise it is available when `(chapterMask ^ 0xFFFF) & (1 << (chapter - 1))` is non-zero. Which `dialog` values count as flag pointers (1..0xAB and 0x200..0x1FFF here) is our reading of BaKGL's choice categories *(unverified)*.

**Clicking.** A left click on a hotspot with a dialogue key (and not a temple) plays the dialogue; afterwards the action runs. The dialogue's `SetEndOfDialogState` value `s` overrides the action when `s + 5` is 4 (nothing), 3 (barmaid), 2 (inn), 1 (leave) or 0 (repair). Goto reloads the scene with `arg1` as the new letter; exit leaves. Shops are implemented (see shops.md), temples and teleports too (see temples.md). Containers, inns, barmaids, lute, repair and chapter end are not implemented yet: their dialogue plays, the action is logged. A right click plays the tooltip dialogue. Escape leaves the scene.

## 3. Scene scripts

### `.ADS`
Tagged file with a `TAG:` chunk (names, unused) and a `SCR:` chunk: `u8 0x02, u32 size`, LZW stream. The decompressed body is a list of scenes:

```
u16 sceneIndex
op* then u16 0xFFFF
```

Ops are a u16 code followed by operands (u16 each): `0x1030/0x1330/0x1350` if-not-played / if-played, 2 operands (`[1]` = script id); `0x13A0` if chapter <= n and `0x13B0` if chapter >= n, 1 operand; `0x1420` and, `0x1430` or, `0x1500` else, `0x1510` end-if-else, `0x1520` end-if, no operand; `0x2000` restart, `0x2005` start (4 operands, `[1]` = script id), `0x2010` stop (3 operands); `0xF010` stop scene (1 operand). A scene is a sequence of if/else blocks of start/stop actions.

To pick the script for a scene index in a chapter: take the first block that starts anything, use its then branch when every chapter condition holds (played tests count as true) and its else branch otherwise, and use the last `start` of that branch.

### `.TTM`
Tagged file with `PAG:`, `VER:`, `TAG:` (u16 count, then u16 id and NUL-terminated name each) and `TT3:` chunks. `TT3:` is `u8 compression (1 = RLE, else stored), u32 size`, then the script bytes. The script is a stream of ops: a u16 `code | count`. Count 0xF means a NUL-terminated name follows, padded so the remaining length is even; otherwise `count` int16 arguments follow. Used codes:

| Code | Meaning |
| --- | --- |
| 0x1110 | start script `arg0` (a TTM holds many scripts; they run to the next 0x1110) |
| 0x1050 / 0x1060 | select image slot / palette slot |
| 0xF050 | load palette `<name>` into the current palette slot |
| 0xF020 | load image set into the current image slot; the name ends `.BMP`, the packed file is `.BMX` |
| 0xF010 | load the full-screen picture; name ends `.SCR`, the file is `.SCX` |
| 0x2000 | set edge and fill colours |
| 0x4000 | clip region: x, y, right, bottom |
| 0xA100 / 0xA110 | filled rectangle / frame: x, y, w, h |
| 0xA500 | sprite: x, y, sprite index, image slot, optional target width and height (scaled). High nibble of the code: 1 flip Y, 2 flip X |
| 0x2010 | show dialogue; key -1 in a still scene draws the actor image (image slot 1, sprite 0) centred at x 160, with its bottom at y 112 |
| 0x0FF0, 0x1020 ... | frame end, delay and animation ops: ignored here |

### Still picture
As BaKGL's static scenes: for the background script then the foreground script, draw the full-screen picture (with the palette of the slot it was loaded into), then every sprite, rectangle and the actor in order. Image sets are `.BMX` (see `bmx.ts`), sprite pixel 0 is transparent, the picture is opaque. Animation frames are not played; later frames of an animated script are drawn over earlier ones. The screen is shown scaled to fit the 2560x1440 HUD (7.2x, centred, nearest neighbour). Rotated sprites, the dialogue background slot and fades are not implemented.
