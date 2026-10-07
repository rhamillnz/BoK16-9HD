import type { HudScreens } from '../ui/hud';
import '../ui/journalScreen'; // registers the journal screen (J)
import { addNote } from './journal';

/** Remember the text of every real dialogue the HUD shows, tagged with the current zone. Plain messages and menus are skipped. */
export function installJournal(opts: { hud: HudScreens; zone: () => number }): void {
  const show = opts.hud.showDialog.bind(opts.hud);
  opts.hud.showDialog = (snippet, labels, done) => {
    // Dialogue snippets carry choices and actions; the menus built by game code are just text.
    if ('actions' in snippet) addNote(snippet.text, opts.zone());
    show(snippet, labels, done);
  };
}
