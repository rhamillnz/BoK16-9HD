# Sound effects: FRP.SX

Layout learned from xavieran/BaKGL (`bak/soundStore.cpp`, `bak/sound.cpp`, `bak/sounds.hpp`), described in our own words. Code: `src/formats/sx.ts`; player: `src/audio/sfx.ts`.

All integers are little-endian. FRP.SX is a sequence of tagged chunks (`tag[4]`, `u32 size`; see `src/formats/tagged.ts`).

## 1. Directory and names

- `INF:` body: 2 unknown bytes, `u16 count`, 1 unknown byte, then `count` x { `u16 id`, `u32 offset` }. The offset is an absolute file offset of the entry's chunk header.
- `TAG:` body: `u16 count`, then `count` x { `u16 id`, NUL-terminated name }. Every id in `INF:` has a name; the original treats a missing one as corruption.

## 2. Entry

At `offset`, behind the 8-byte chunk header: `u16 id` (repeats the directory id), `u8 type`, 2 unknown bytes, `u32 size`, 2 unknown bytes, then `size - 2` bytes of body. Offsets inside the body count from its first byte.

The body starts with a directory of sounds and is followed by the voice data:

```
sound*  := selector:u8 voiceRef* 0xFF       (selector 0xFF ends the list)
voiceRef := code:u8 (not 0xFF)  skip:u8  offset:u16  size:u16
```

Each `voiceRef` names `size` bytes of voice data at `offset` in the body. The original's `Sound` keeps one buffer per sound and the last voice wins; we keep every voice.

## 3. Voices

The first byte is a code; the low nibble is the channel. One more byte follows and is skipped.

- **Wave** (code `0xFE`): `u16 rate`, `u32 size`, 2 unknown bytes, then `size` bytes of unsigned 8-bit mono PCM at `rate` Hz.
- **Note stream** (anything else): a stream of { delta, event }. The delta is a byte preceded by any number of `0xF8` bytes, each adding 240 ticks. The event is a status byte followed by data: note-on `9c key velocity` (velocity 0 means note-off), control `Bc ctl value`, patch `Cc program`, pitch `Ec lo hi`, or `0xFC` to end. `c` must equal the voice's channel. A byte that is not one of these statuses repeats the previous status (running status). Events are ordered by their absolute tick; ties keep stream order. `src/formats/sx.ts` repackages them as a format-0 Standard MIDI File, 32 ticks per quarter note. The file has no tempo event, so we use the MIDI default of 120 beats per minute (one tick is about 15.6 ms). The browser has no MIDI synth, so `src/audio/noteSynth.ts` plays these with oscillators: each note gets a short attack and release, a waveform picked from its General MIDI patch family, and the pitch wheel (range of two semitones) is sampled at note start. Effects are capped at 12 seconds.

## 4. Sound numbers the game uses

From BaKGL's `sounds.hpp` and its screens: teleport/cure chime 0x0c; sword miss swing 19, (thrust miss 25, absent from some installs); parry sword 7; staff parry 67; sword hit 65; staff hit 66; fist hit 74; zap 26; door open 38, close 39; rope 0x32; chest explosion 0x39; shop buy/sell 60; inventory drag 61; bless 0x3e; lock: pick broke 5, picked 0x16, use key 0x1e, open 30, key broke 0x2b. Melee hits by monster: fists for monsters 19, 28, 41, 42, 43, 46, 48; zap for 39, 44, 49, 58; sword otherwise.

Item use plays the item's `useSound` (OBJINFO) `soundPlayTimes + 1` times. Dialogue action `PlaySound` carries the sound number in its first word.

## 5. How the game plays them

Game modules call `playSfx(id)` from `src/audio/sfxBus.ts`; `installSfx()` (`src/audio/sfxWiring.ts`) loads `/bak/frp.sx`, decodes waves on first use and caches them, plays note-only effects through the oscillator synth when an entry has no wave, caps playback at 8 voices, and M mutes it with the music. Without game data the calls do nothing.
