# Dialogue files (`DIAL_Zxx.DDX`)

Derived from reading xavieran/BaKGL (`bak/dialog.cpp`, `dialogChoice.cpp`, `dialogAction.hpp`) for understanding only; parser is `src/formats/ddx.ts`. All integers little-endian. Items marked *(unverified)* come from BaKGL's own guesses and have not been checked against game data here.

## 1. Files

One file per zone: `DIAL_Z00.DDX` … `DIAL_Z31.DDX` (32 files, zone number = file number).

```
u16   count
count x { u32 key; u32 offset }     index: dialogue key -> snippet offset in this file
snippet*                            snippets back to back until end of file
```

`offset` is an absolute byte offset from the start of the file to a snippet header. Snippets are read sequentially, so every snippet (including ones only reachable from another snippet's choice) is addressable by its offset.

## 2. Snippet

```
u8   displayStyle     where text is shown
u16  actor            speaking actor id; 0xFF = party leader
u8   displayStyle2
u8   displayStyle3    choice presentation
u8   choiceCount
u8   actionCount
u16  textLength       bytes
choice  x choiceCount   (10 bytes each)
action  x actionCount   (10 bytes each)
u8[textLength]          text
```

Header is 9 bytes (`u8 + u16 + 4 x u8 + u16`; the parser and tests use this). Text follows the actions and is not NUL-terminated by the length; BaKGL reads exactly `textLength` bytes. Our parser decodes them as Latin-1 up to the first NUL. Control bytes in the text are described in section 6 and handled by `src/formats/textCodes.ts`.

### displayStyle *(per BaKGL comments, unverified)*
0x00/0x06 centre of full screen; 0x02 action area; 0x03 non-bold at bottom; 0x04 bold at bottom; 0x05 large action area.

### displayStyle3
`0x0` no choices; bit `0x2` query (side-by-side prompt such as Yes/No); `0x4` dialogue-tree root (choices in a grid, "X asked about"); `0x8` pick a random choice.

## 3. Choices

```
u16 state    condition / keyword selector
u16 min
u16 max
u32 target   0 = none (end); any bit of 0xF0000000 set = key target (key = target & ~0xF0000000);
             otherwise = offset of another snippet in the same file
```

`state` is categorised by the first of these upper bounds that it does not exceed (BaKGL `CategoriseChoice`):

| state ≤ | Category | Meaning |
| --- | --- | --- |
| 0x0000 | none | unconditional |
| 0x00AB | conversation | keyword index shown as a topic; state doubles as an event pointer |
| 0x01FF | query | keyword prompt (Yes 0x100, No 0x101, Accept 0x104, Decline 0x105, Haggle 0x106) |
| 0x1FFF | eventFlag | tests an event flag at `state` |
| 0x75FF | gameState | one of the active-state flags below |
| 0x9CFF | customState | scripted scenario, id = `state & ~0x9C40` |
| 0xC3FF | inventory | party has item `(state + 0x3CB0) & 0xFFFF` |
| 0xC7FF | haveNote | note `(state + 0x38C8) & 0xFFFF` |
| 0xCBFF | castSpell | spell `state - 0xCB21` |
| 0xCFFF | random | range `(state + 0x30F8) & 0xFFFF` |
| 0xDFFF | complexEvent | event pointer with extra masks |
| else | unknown | |

Game-state flags (all *unverified* names): 0x7530 context, 0x7531 money, 0x7533 can't afford, 0x7537 chapter, 0x7539 night, 0x753A day, 0x753C time between, 0x753D skill check, 0x753E item value, 0x753F context2, 0x7542 shop, 0x7543 zone, 0x754D gambler.

`min`/`max` are the range operands tested against the selected value; the parser keeps them raw.

## 4. Actions

Every action is 10 bytes: `u16 type` then an 8-byte payload. Unknown types keep the raw payload. Payload layouts (`w0..w3` = u16 words):

| Type | Name | Payload |
| --- | --- | --- |
| 0x01 | SetTextVariable | w0 which, w1 what |
| 0x02 | GiveItem | u8 item, u8 character, w1 quantity |
| 0x03 | LoseItem | w0 item, w1 quantity (0 means 1) |
| 0x04 | SetFlag | w0 event pointer, u8 mask, u8 data, w3 value |
| 0x05 | LoadActor | 3 ids *(unverified)* |
| 0x06 | SetPopupDimensions | w0 x, w1 y, w2 width, w3 height |
| 0x07 | SpecialAction | w0 kind (gold, repair, combat, gamble …), w1–w3 args |
| 0x08 | GainCondition | w0 who, w1 condition, i16 min, i16 max |
| 0x09 | GainSkill | w0 flag, w1 skill, i16 min, i16 max |
| 0x0A | LoadSkillValue | w0 target, w1 skill |
| 0x0C | PlaySound | w0 sound, w1 flag |
| 0x0D | ElapseTime | u32 time |
| 0x0E | SetAddResetState | w0 state, w1 unknown, u32 time |
| 0x0F | FreeMemory | ignorable |
| 0x10 | PushNextDialog | u32 target (same rules as choices) |
| 0x11 | UpdateCharacters | w0 n (≤3), then n character ids |
| 0x12 | HealCharacters | w0 who, w1 amount |
| 0x13 | LearnSpell | w0 who, w1 spell |
| 0x14 | Teleport | w0 teleport index |
| 0x15 | SetEndOfDialogState | i16 state |
| 0x16 | SetTimeExpiringState | u8 type, u8 flag, w1 state, u32 time |
| 0x17 | LoseNOfItem | like LoseItem |
| 0xFF | bugged | non-zero junk payload; ignore |

The parser decodes the common fields above into `fields` and always keeps `raw` and `words`. Time units for ElapseTime and friends are *unverified*.

## 5. Resolving a conversation

1. Start from a dialogue key; look it up in the file index to get a snippet.
2. Show its text, apply its actions, then evaluate choices. A key target restarts at step 1 (the key may live in a different file); an offset target jumps to that snippet in this file.
3. With no choices a snippet ends the dialogue, or follows an earlier PushNextDialog.

Keyword strings (`KEYWORD.DAT`) and NPC names are separate files and are not handled by `ddx.ts`.

## 6. Text control codes

Derived from BaKGL's text box (`gui/textBox.cpp`) for understanding only; tokenizer is `src/formats/textCodes.ts`, used by `src/ui/dialogBox.ts`. Real DDX text confirms control bytes occur (e.g. a leading `0xF3`), so none may reach the glyph renderer.

| Byte | Effect |
| --- | --- |
| `\n` | new line (we treat it as a paragraph break with a blank row; empty paragraphs are dropped) |
| `\t` | four spaces, clears bold |
| space, `0xE1`-`0xE3` | space (`0xE1`-`0xE3` are half-width book decoration; we draw a normal space); a space clears emphasis and italic |
| `#` | toggles bold (it is **not** a paragraph break) |
| `0xF0`, `0xF1` | emphasis (yellow highlight) until the next space |
| `0xF3` | italic (lowlight colour) until the next space |
| `0xF4` | toggles "unbold" (muted) |
| `0xF5` | toggles red |
| `0xF6` | toggles white |
| `0xF7` | toggles Moredhel script (BaKGL draws three offset layers; we only tint it) |
| `0xF8` | half-line advance; we use a forced line break within the paragraph |
| `0xF9` | toggles inactive (greyed) |

At a paragraph end emphasis, italic, unbold, inactive, red, white and Moredhel reset; bold carries over. Other bytes below 0x20, `0x7F`, `0xF2` and `0xFA`-`0xFF` are unknown and silently dropped. Printable Latin-1 above 0x7F is left alone. Centring and the bold-text bottom box come from the snippet's `displayStyle`, not from in-text codes. The word-wrapper measures glyph widths only, so styles never change line breaking (faux-bold is drawn with a 1px offset).

### 6.1 Text variables (`@N`, `@`)

Derived from BaKGL (`bak/textVariableStore.cpp`, `bak/gameState.cpp` `SetDialogTextVariable`, `bak/dialogAction.hpp`) for understanding only; our code is `src/game/textVariables.ts`. Substitution runs on snippet text (and choice labels) after the control codes are in place, before tokenising.

- `@` followed by a digit is variable N (BaKGL stores variables by their `@N` text and replaces each in turn, so only one digit is meaningful). A bare `@` is the active character's name, replaced last.
- A dialogue starts with defaults: `@4` is the party leader, then `@5`, `@3`, `@0` are random party members. The leader is Pug if he is in the party, else by chapter 1-9: Locklear, James, James, Gorath, James, Owyn, James, Owyn, Pug.
- Action 0x01 SetTextVariable (w0 variable, w1 source) refills a variable. The source is an attribute code (the original switches on `what - 1`):

| `what` | Value |
| --- | --- |
| 1-6 | character 0-5 (Locklear, Gorath, Owyn, Pug, James, Patrus) |
| 7 | party leader |
| 11 | active character |
| 12 | character picked by the last skill check |
| 13-16, 31 | random party member not already picked (14 magicians: Owyn, Pug, Patrus; 15 swordsmen: Locklear, Gorath, James; 16 Gorath or Patrus; 31 anyone but the leader) |
| 17 | monster name |
| 18 | chosen item's name |
| 19 | item value, as money text |
| 20 | party gold, as money text |
| 21, 22, 10, 30 | empty (health left, unknown contexts) |
| 28 | "shopkeeper" (a tavern keeper in an inn) |
| 29 | the skill that just improved |

- Money text is `<n> sovereign(s)` and `<n> royal(s)` joined by "and", each number and unit led by the emphasis byte 0xF0 (ten royals per sovereign).
- Characters picked for a variable are also what the "who" of later actions (item, condition, heal) addresses; `DialogSession.dialogCharacters` carries them (0xFF means none).
- Unset variables (the original leaves a literal `@N`) show the active character here. Unknown sources are ignored.
- Deviation: the original only avoids repeating characters among lower-numbered variables; we avoid every variable already filled.

## 7. Encounters and running a conversation

Derived from BaKGL (`bak/encounter/dialog.cpp`, `block.cpp`, `bak/state/encounter.cpp`, `gui/dialogRunner.cpp`) for understanding only; our code is `src/game/encounterRunner.ts`.

**Encounter to dialogue.** A dialog encounter (type 3) has `tableIndex` into `DEF_DIAL.DAT`; a block encounter (type 11) uses `DEF_BLOC.DAT` the same way. Both files are `u32 count` then `count` records of 9 bytes: 3 unknown bytes, `u32` dialogue key, `u16` unknown. The key is looked up in the **global** key map built from all 32 `DIAL_Zxx.DDX` files (lowest file number wins a duplicate); it is not tied to the current zone. Offset targets stay in the file of the snippet that holds them. Block also stops the party (the original undoes the last step).

**Flags.** An encounter is skipped when a "used" flag is set: the per-encounter flag at event pointer `(zone - 1) * 0x190 + tileIndex * 10 + encounterIndex + 0x190` (`tileIndex` is the tile's position in `ZxxREF.DAT`), or the party already triggered it since entering the tile ("recently encountered", cleared on tile change). When a dialog encounter starts: set `completionState` if non-zero; unless `repeatable`, set the per-encounter flag if `chapterFlag != 0` and mark it recently encountered. Block (and enable/disable/zone) set the per-encounter flag whenever `chapterFlag != 0`, ignoring `repeatable`.

**Conversation loop.** A stack of pending targets; the start key is pushed first. Entering a snippet runs its actions (`PushNextDialog` pushes, `SetFlag` sets bits, `SetEndOfDialogState` -1 clears the stack). A snippet is shown if it has text or is a topic list (`displayStyle3 == 4`). After a snippet with no pending pick, the next target is: a random choice for style 8; else the first choice whose condition holds; else the stack top; an empty stack or key 0 ends. Condition: the value selected by `state` (event flag 0/1, game state, inventory, random `rand(0x1000) % range`...) must be `>= min` and (`max == 0xFFFF` or `<= max`). Conversation and query choices do not evaluate on their own: the player picks them.

- Query snippets (`displayStyle3 & 2`): buttons are the query choices, labelled from `KEYWORD.DAT` (Yes 0x100, No 0x101, Accept 0x104, Decline 0x105, Haggle 0x106).
- Topic snippets (`displayStyle3 == 4`): one entry per conversation choice whose event pointer is set and whose inhibit flag (`0x1a2c + pointer`) is clear, plus "Goodbye". Picking a topic marks it clicked (`0x1d4c + pointer`) and pushes its target; Goodbye (no match) pops the stack.
- `KEYWORD.DAT`: `u16 length`, `u16` string offsets up to file offset `0x2b8` (347 entries), NUL-terminated strings at those offsets. Indices below `0xAC` are topic names, indexed by event pointer.

### 7.1 Applying actions after the dialogue

`DialogSession` applies `SetFlag`, `PushNextDialog`, `SetEndOfDialogState` and records `Teleport`; every other action lands in `pendingActions`. When the dialogue ends, `src/game/dialogEffects.ts` applies them (semantics from BaKGL `GameState::EvaluateAction`, understanding only):

- `GiveItem`: bytes `item, who`, `u16` quantity. Item 53 is sovereigns and 54 royals: they add to the purse (1 sovereign = 10 royals, `gold` in the save counts royals). Key items go to the key ring. Anything else goes to the first active character with room, stacking onto an existing stack up to the item's `stackSize`. `who` 0 and 1 mean "the party"; 2 and up address the dialogue's character list.
- `LoseItem` / `LoseNOfItem`: remove from the party in order, money items from the purse; gold never goes below 0.
- `HealCharacters`: `who` 0/1 is the active party. An amount of 100 or more is a full rest (all conditions -100, health to max, time last slept = now). Below 100 the original takes 20 percent off current health (used at the start of chapter 4).
- `GainCondition`: amount is `min`, or `min + rand(0x1000) % (max - min)` when they differ; the condition is clamped to 0..100.
- `LearnSpell`: `who` indexes the dialogue's character list directly; sets the spell bit.
- `UpdateCharacters`: replaces the active party.
- `ElapseTime`, `SetAddResetState` (sets the flag now and queues a reset-state timer with flags 0x40), `SetTimeExpiringState`: world clock and expiring events.
- `SpecialAction` 0 / 1: lose / gain the "item value" game state (0x753e) in royals. Other specials are not applied.

Not applied (returned as `unhandled`): skills (`GainSkill`, `LoadSkillValue`), sounds, actor loading, popup sizes, combat specials and the rest of `SpecialAction`. "Who" selection follows the characters the text variables picked (section 6.1); without a text context those actions fall back to the whole active party.

### 7.2 Teleports and zone transitions

`Teleport` carries an index into `TELEPORT.DAT` (11-byte records: `u8` zone, tile x, tile y, cell x, cell y, `u16` heading, `u16` hotspot, `u16` hotspot char; zone `0xff` stays in the current zone; a non-zero hotspot is a town or temple scene to enter on arrival). The destination is the centre of the cell, `tile * 64000 + cell * 1600 + 800`; heading is the high byte of the `u16`. The original performs the teleport once the dialogue has closed.

Zone encounters (type 8) index `DEF_ZONE.DAT`: `u32 count`, then 20-byte records: 3 unknown bytes, `u8` zone, tile x/y, cell x/y, `u16` heading, `u32` dialogue key (0 = none), 6 unused bytes. With a dialogue, it is shown first and the party leaves afterwards. *Unverified:* how the original decides that the player declined; we stay when the dialogue is cancelled or the last query answer was "No".

When the target zone differs from the current one the zone scene is rebuilt (`src/game/zoneHost.ts`), encounters are reloaded for the new zone and the zone song starts; the party is placed without firing the encounters it arrives in.

Scripted `customState`, `haveNote` and `castSpell` choices, party money and shop context still read as 0 in choice conditions.
