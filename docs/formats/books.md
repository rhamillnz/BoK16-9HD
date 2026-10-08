# Book chapters (`.BOK`)

Derived from reading xavieran/BaKGL (`bak/book.cpp`, `gui/bookPlayer.cpp`) for understanding only; the code is `src/formats/book.ts` (`parseBook`, `bookText`), `src/game/book.ts` (`layoutBook`), `src/ui/bookScreen.ts` and `src/game/bookControls.ts`. Items marked *(unverified)* are our reading and not checked against game data (none exists in the cloud; the tests use synthetic fixtures).

Books are the illustrated story pages shown at the start and end of a chapter (`Cn1.BOK`, `Cn2.BOK`) and when a cutscene shows dialogue type 2 (`C<NN>.BOK`, NN = the key as two digits). See `cutscenes.md` section 5 for when they play.

## 1. File layout

All numbers little-endian.

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u32 | file size (not needed) |
| 4 | u16 | page count |
| 6 | u32 x count | page offsets, each counted from byte 4 of the file |

## 2. Page

| Type | Meaning |
| --- | --- |
| i16 x 4 | text box: x, y, width, height, in *book units* (twice scene pixels) |
| u16 | display number |
| u16 x 3 | page number, previous page, next page |
| u16 + 2 bytes | a pointer and a reserved word (skipped) |
| u16 | image count |
| u16 | reserved-area count |
| u16 | show-page-number flag |
| 30 bytes | skipped *(unknown)* |
| reserved areas | i16 x, y, width, height each |
| images | i16 x, y; u16 image index into `BOOK.BMX`; u16 mirroring (0 none, 1 horizontal, 2 vertical, 3 both) |

Then a stream of records until byte `0xf0` (end of page):

- `0xf1` starts a paragraph: i16 x, i16 width, u16 line spacing, u16 word spacing, u16 start indent, 2 bytes skipped, i16 y, u16 alignment (1 left, 2 right, 3 justify, 4 centre).
- `0xf4` starts a text segment (needs an open paragraph): u16 font, i16 y offset, u16 colour, 2 bytes skipped, u16 style bits (1 normal, 2 bold, 4 italic, 8 underlined, 16 ghosted), then the text: every following byte below `0xb1`.
- any other byte is skipped.

## 3. Showing a book

The player shows the screen `BOOK.SCX` with the palette `BOOK.PAL`, the page's images from `BOOK.BMX` at half their book position and size, and text. The original takes the paragraphs of the **first page only** and builds one string: four spaces, then for each paragraph four spaces, its segments (an italic segment gets the italic mark `0xf3` first) and a paragraph end (`\n` + `0xf8`). That text is poured into the text box of page 0, and what does not fit goes into the box of page 1, and so on, wrapping back to page 0. Each click turns to the next page; the click after the last text is shown ends the book. We follow this, wrapping to the first page's box width and counting rows as font height + 1 *(the original's line spacing factor is unverified)*. A book with no text shows one page per page record. Reserved areas are not used by the original and not by us. Pictures never sit under the text: for every text row a picture overlaps inside the box, a picture in the left half indents the row beside it and one in the right half shortens it (2 scene pixels of gap; a picture leaving under a quarter of the width is ignored), so an illuminated initial such as the "B" on page 1 of C11.BOK has the first lines wrapped beside it *(our own rule; the original's handling is unverified)*.

## 4. In the game

`installBookPlayer` (src/game/bookControls.ts) returns `playBook(file)`, which opens the modal HUD screen `book`: click, Space, Enter or Right turn the page, Escape skips the book. It resolves at once when the book file is missing. `?book=C11.BOK` plays one at start for checking against real data. The cutscene player (`installCutscenes`) gets `playBook` for dialogue type 2 and for the book steps of chapter transitions; the cutscene screen stays underneath and comes back after the book.

Music changes in cutscenes: TTM op `0xc050` with an index of 255 or more is a music change, the index being 1000 + song number (the same sound index the town scenes use). The song playing before the first change returns when the cutscene ends (the original pushes tracks and pops them at the end). Not implemented: the font styles of segments beyond italic, page numbers.
