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

## Hand-over between chapters
Implemented in `src/game/chapterHandover.ts`, run by `transitionToChapter` after the heal and before the start script. Save character slots: Locklear 0, Gorath 1, Owyn 2.
- Money: from chapter 2 on, the party's purse is written to a per-chapter u32 slot at `0x12f7 + ((chapter - 1) << 2) + 0x64` of the save image.
- Chapter 3: a quest flag is reset (left to the start script).
- Chapter 4: Owyn's and Gorath's inventories are copied into zone 12 chests (at 694800,700800 and 698400,696800) and emptied; each is given six torches, Gorath's lit. The purse becomes 0.
- Chapter 5: Locklear's inventory is replaced by the contents of a zone 0 reference container (position 10,0), and its first sword, armour and crossbow are equipped. The purse is the chapter 4 slot.
- Chapters 6, 7, 8: the purse is the slot of the previous chapter.
- Inventory swaps need the container store (`ChapterHost.containers`); without it only money is handled.

## Open values (machinery done, values missing)
`src/game/chapterRules.ts` runs after the hand-over in `transitionToChapter`. Its three tables are empty on purpose: the real values were not verified (BaKGL was not readable when this was written), and guessed values would be wrong.
- `TOWN_STASH_RULES`: per chapter and character slot, a town container (scene number and letter, as in the save's town container table, see shops.md) and a mode: `store` (pack into the container, pack emptied) or `fetch` (container becomes the pack, container emptied). Missing: which containers are Locklear's room (chapter 2) and the Lurough inns (chapter 6), who is stored or fetched and when.
- `CHAPTER_START_FLAGS`: event pointers set when a chapter starts. Missing: what the chapter 7 flag `0x1ab1` does (set or reset, and when).
- `CHAPTER_EXPIRY_STEPS`: number of half-hour expiry steps run at chapter start (`runExpirySteps` lets expiring events elapse without moving the clock). The original runs 80; what each step expires is not known, so the table is 0 for every chapter.
Not wired in `main.ts`: `ChapterHost.towns` takes a `TownStashSource` (get and set of a town container by scene ref) and no source is supplied yet, because there are no rules to run. Supply one backed by the shop store when the rules are filled in.
