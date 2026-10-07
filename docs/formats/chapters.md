# Chapter transitions

Derived from reading BaKGL (`bak/chapterTransitions.cpp`, `bak/cutscenes.cpp`, `gui/guiManager.cpp`) and described in our own words. Implemented in `src/game/chapters.ts` (pure rules) and `src/game/chapterControls.ts` (wiring).

## When a chapter ends
- A dialogue runs a SetFlag action on event pointer `0x7541`. This pointer has no saved bit; the original treats it as a one-shot request, and so do we (`scriptedState.chapterTransition`, set in `applySetFlag`). After the dialogue finishes, `ChapterControls.afterDialog()` starts the transition.
- A town hotspot with action `ChapterEnd` (0xf). After its dialogue, `TownController.handle(HotspotAction.ChapterEnd, ...)` starts the transition.

## Order of events
1. Cutscenes: the ending of the old chapter, then the intro of the new one (below).
2. World reset (`transitionToChapter`).
3. The new chapter's map caption: dialogue key `0x126 + chapter - 1`, shown over the map in the original, as a dialogue box here.
4. Teleport to the `CHAPn.DAT` start (zone, tile, cell, heading), then to a TELEPORT.DAT entry if the chapter's start script asked for one (chapters that open inside a town or temple).

## Cutscenes
Intro of chapter n: animation `CHAPTERn` (ADS + TTM), book `Cn1.BOK`, animation `Cn1`.
Ending of chapter n: book `Cn2.BOK` (not for chapters 2, 4, 6, 7, 8), then animation `Cn2` (chapter 9: `C93`). There is no ending after the last chapter.
Playback uses the cutscene player (`chapterFinishCutscenes` then `chapterStartCutscenes` in `cutscene.ts`, run through `installCutscenes`); book steps are skipped until a book viewer exists.
The chapter recap text (contents screen) is dialogue key `0x186ab6 + chapter - 1`.

## World reset
- Time: next midnight plus `timeChange` from `CHAPn.DAT`, and the last-slept time is set to it (`startChapter` in `state.ts`).
- Per-encounter "done" flags (`0x190`, `0x12c0` of them) are cleared so encounters fire again.
- Every active character: all conditions cleared, health to maximum.
- Start-of-chapter script, dialogue key `0x1e8497`: its first choice leads to a snippet whose actions reset story flags; its first action is a push to a table whose n-th choice is chapter n's script. A script runs its actions and then follows the last of its choices whose condition holds, until a snippet with no choices; that final snippet's actions run too. Teleport actions are collected, everything else goes through the normal dialogue effects.

## Not done yet
BaKGL also shuffles inventories between chapters (Locklear's room in chapter 2, Owyn and Gorath's chests in chapter 4, Locklear's chapter 5 kit and equipment, the Lurough inns in chapter 6) and keeps party money per chapter. These need the container store and money-per-chapter offsets and are left out; the 80 half-hour expiry steps the original runs are also left out.
