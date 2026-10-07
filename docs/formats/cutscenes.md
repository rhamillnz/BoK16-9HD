# Cutscenes (`.ADS` / `.TTM` animations)

Derived from reading xavieran/BaKGL (`bak/scene/scene.cpp`, `ttmRunner.cpp`, `ttmRenderer.cpp`, `spriteRenderer.cpp`, `gui/dynamicTTM.cpp`, `gui/cutscenePlayer.cpp`, `bak/cutscenes.cpp`) for understanding only; the code is `src/formats/ttm.ts` (`parseTtmFrames`), `src/game/cutscene.ts`, `src/ui/cutsceneScreen.ts` and `src/game/cutsceneControls.ts`. The file layouts of `.ADS` and `.TTM` are in `towns.md` section 3; the town scenes show these files as a still picture, the cutscene player plays them. Items marked *(unverified)* are our reading and not checked against game data (none exists in the cloud; the tests use synthetic fixtures).

## 1. Frames and scripts

A TTM's `TT3:` stream is cut into **frames** by op `0x0ff0` (end of frame). All scripts of the file are laid end to end; a script is the run of frames from the one that opens with `0x1100` or `0x1110` (arg0 = script id, the frame's *tag*) up to a frame holding `0x0110` (end script). Op `0x1200` (goto tag, arg0 = tag) makes the script continue at the frame with that tag instead of the next one, which is how animations loop; with no such frame the script ends.

Ops beyond those in `towns.md` (code, arguments):

| Code | Args | Meaning |
| --- | --- | --- |
| 0x0020 | | save background: screen layer to background layer |
| 0x0110 | | end of script |
| 0x0ff0 | | end of frame |
| 0x1020 | ticks | delay after this frame, in ticks of 17 ms; stays in force for later frames until changed |
| 0x1120 | layer | select the save layer for `0x4210`/`0xa600` |
| 0x2000 | edge, fill | colours for rectangles of this script (reset to 15, 15 at a script start) |
| 0x2010 | key, type | show dialogue text (section 3); key -1 or 0xff or 0 = clear text |
| 0x4000 | x, y, right, bottom | clip region, inclusive; stays until replaced |
| 0x4110 / 0x4120 | startColor, steps, endColor, duration | fade out / in (section 4) |
| 0x4200 | x, y, w, h | copy that rectangle of the screen onto the background |
| 0x4210 | x, y, w, h | remember that screen rectangle in the current save layer |
| 0xa600 | layer | draw the rectangle remembered in that save layer back at its place |
| 0xa5a0 | x, y, sprite, slot, w, h, angle | sprite rotated by `angle` degrees about (x, y), drawn w x h *(angle unit unverified)* |
| 0xb600 | x, y, w, h, source, target | copy a rectangle between layers (0 flip, 1 screen, 2 background, 3 save) |
| 0xc050 | index | play sound `index`; 255 and above change the music track |

Names (`0xf010` screen, `0xf020` image, `0xf050` palette) load into the *current* slot (`0x1050` image slot, `0x1060` palette slot). Slots are global to the file, not per script: every sprite uses the current palette slot. Loading a screen draws it on the screen layer and copies it to the background layer. A frame that references a missing slot or resource just skips the draw.

## 2. Drawing

Three 320x200 layers matter: *screen* (what is shown), *background* and *save*. Ops draw onto the screen. When a frame has been drawn it is shown, then the screen layer is reset to the background, so sprites last one frame unless `0x0020`/`0x4200`/`0xb600` put them on the background. Sprite pixel 0 is transparent, the screen picture is opaque. A scaled sprite (6 args) samples the source across the target size: target pixel i takes source `floor(i / (targetSize - 1) * (sourceSize - 1))`; a negative size mirrors.

## 3. ADS: which scripts run

The ADS (parsed by `parseAds`) is a list of if-blocks. The runner keeps a set of *started* and *finished* scripts and the list of *running* ones. Before each display frame it walks every block of every scene in file order and fires the **first** block whose conditions all hold (and/or are both treated as and): its `then` actions start or stop scripts (`else` is not used). Conditions: script not started, script finished (finished = ran off its end or hit end-script; stopping does not finish it), chapter >= n, chapter <= n. Starting a script that has no frame, or that already runs, only marks it started.

A display frame is then every running script's next frame, ops concatenated in start order; a script whose frame list runs out is finished. When nothing runs, the cutscene is over. A block that keeps matching is fine as long as it also tests "not started", as the original files do.

## 4. Timing

Per frame, in op order: `delay` sets the hold time; `sound` plays at once; `dialogue` may pause; a fade may run. After the last op the frame's picture is shown (unless a fade-in already showed it), the fade cover is cleared unless the script ended in this frame, and the player waits the delay before the next frame.

- **Dialogue** `(key, type)`: type 2 hands the key to the book player (`C<NN>.BOK`, NN = key as two digits) and waits for it, type 5 runs the full dialogue for the key and waits. Otherwise the text of dialogue key `0x186a00 + key` shows in the lower text box (15, 125, 285 x 66 scene pixels); types other than 3 wait for a click first; types 1 and 4 clear the text when the frame ends; others leave it until a clear. A key that has no text is not waited on. Clicks during a delay or fade are ignored.
- **Fades** use the colour at palette index `endColor` of the current palette slot as a cover: fade-in shows the new picture first, then the cover goes from solid to clear; fade-out goes from clear to solid over the old picture. Duration index to seconds: 0, 0.1, 0.4, 0.8, 1.6, 3.2, 6.4 (0 = instant). With `startColor` below 16 the cover is the whole screen, otherwise only the picture window (15, 11, 289 x 101) *(the original's own hack, see `gui/dynamicTTM.cpp`)*.

## 5. Chapter cutscenes

`bak/cutscenes.cpp`: at the start of chapter n play `CHAPTERn.ADS/.TTM`, the book `Cn1.BOK`, then `Cn1.ADS/.TTM`. At its end play the book `Cn2.BOK` (not in chapters 2, 4, 6, 7, 8) and then `Cn2.ADS/.TTM` (`Cn3` in chapter 9); chapter 10 has none. `chapterStartCutscenes` and `chapterFinishCutscenes` list these; wiring them into chapter changes belongs to the chapter-transition work, and the book player is not implemented here (book steps are skipped unless the game passes `playBook`).

## 6. In the game

`installCutscenes` (src/game/cutsceneControls.ts) returns `{ play(ads, ttm), playSteps, playChapterStart, playChapterFinish }`. A cutscene opens the modal HUD screen `cutscene` scaled to fit the HUD: click or Space/Enter continues past text, Escape skips. `?cutscene=CHAPTER1.ADS,CHAPTER1.TTM` plays one at start for checking against real data. Sound effects (index below 255) play through the sound-effect bus; music changes need a `sound` callback. Not implemented: the book player, full-dialogue hook wiring, palette fades of the whole 256-colour table (fades are an RGBA cover).
