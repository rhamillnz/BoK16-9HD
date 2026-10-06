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

Header is 8 bytes. Text follows the actions and is not NUL-terminated by the length; BaKGL reads exactly `textLength` bytes. Our parser decodes them as Latin-1 up to the first NUL. Control bytes in the text are described in section 6 and handled by `src/formats/textCodes.ts`.

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
