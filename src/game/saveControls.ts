import type { SaveHandler } from '../ui/hud';
import { QUICK_SLOT, SaveGames, createSaveStore, type SaveGameData } from './saveGame';
import { slotLabel } from '../ui/saveScreen';
import { captureSaveExtras, restoreSaveExtras } from './saveExtras';

export interface SaveControlsHost {
  /** Snapshot of the running game. */
  capture(): SaveGameData;
  /** Replace the running game with a loaded one (may reload the zone). */
  restore(data: SaveGameData): Promise<void>;
  /** False while a dialogue or other modal flow owns the game: quick keys do nothing then. */
  canQuickSave(): boolean;
  setSaveHandler(handler: SaveHandler): void;
}

function toast(text: string): void {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);padding:6px 14px;background:rgba(24,16,8,.92);color:#f0e0b8;border:1px solid #c8a050;font:14px monospace;z-index:10;pointer-events:none';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

/** F5 quick-saves, F9 quick-loads, and the HUD's F6 slot screen is wired to the same store. */
export async function installSaveControls(host: SaveControlsHost): Promise<SaveGames> {
  const games = new SaveGames(await createSaveStore());
  const save = async (slot: string): Promise<string> => {
    await games.save(slot, { ...host.capture(), extras: captureSaveExtras() });
    return `Saved to ${slotLabel(slot)}`;
  };
  const load = async (slot: string): Promise<string> => {
    const data = await games.load(slot);
    if (!data) return `Failed: ${slotLabel(slot)} is empty`;
    restoreSaveExtras(data.extras);
    await host.restore(data);
    return `Loaded ${slotLabel(slot)}`;
  };
  host.setSaveHandler({ list: () => games.list(), save, load });

  window.addEventListener('keydown', (e) => {
    if (e.repeat || (e.code !== 'F5' && e.code !== 'F9')) return;
    e.preventDefault();
    if (!host.canQuickSave()) return;
    const run = e.code === 'F5' ? save : load;
    run(QUICK_SLOT).then(toast, (err: Error) => toast(`Failed: ${err.message}`));
  });
  return games;
}
