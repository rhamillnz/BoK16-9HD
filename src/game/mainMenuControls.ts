import type { Post } from '../render/post';
import type { HudScreens } from '../ui/hud';
import { MENU_SCREEN_ID, type MenuPanelScreen } from '../ui/menuHud';
import type { MusicPlayer } from '../audio/music';
import type { TitleArt } from '../ui/titleScreen';
import { showControlsMenu } from './rebindMenu';
import { getSettings, setSettings } from './settingsStore';
import {
  keyHelpModel,
  mainMenuModel,
  optionsModel,
  stepFov,
  stepQuality,
  stepUiScale,
  stepVolume,
  type MainMenuId,
  type OptionsId,
} from './mainMenu';

export interface MainMenuHost {
  screens: HudScreens;
  music: MusicPlayer;
  post: Post;
  /** Applies a changed graphics quality (shadows, grass) and may announce it. */
  applyGraphics(announce: boolean): void;
  /** Pictures for the title screen shown behind the menu when the game starts. */
  titleArt?: TitleArt;
  /** False while a fight, travel or other flow owns the game. */
  canOpen(): boolean;
  /** Song for the title menu; `startGameMusic` takes over when the menu first closes into the game. */
  titleSong?: number;
  startGameMusic?: () => void;
  /**
   * The opening: the title animation, then the story (chapter 1's card, book and first scene). The whole of it plays
   * on the very first launch and from the menu; New game plays just the story (`storyOnly`).
   */
  playIntro?: (storyOnly?: boolean) => Promise<void>;
}

const SKIP_KEY = 'bok.skipMenu';
/** Value of SKIP_KEY after New game: skip the menu and play the story opening. */
const STORY = 'story';
/** Set once the whole introduction has played by itself, on the first launch. */
const INTRO_SEEN_KEY = 'bok.introSeen';

/**
 * The main menu: shown when the game starts and on Escape when nothing else is open. New game, Continue
 * (the newest save), Load (the F6 slot screen) and Options (graphics, music, key help).
 */
export function installMainMenu(h: MainMenuHost): Promise<void> {
  const panel = h.screens.screenHandler<MenuPanelScreen>(MENU_SCREEN_ID);
  let settings = getSettings();
  let started = false;
  let hasSave = false;
  let newest: string | undefined;

  const persist = () => setSettings(settings);
  h.music.setVolume(settings.volume);
  h.music.setMuted(settings.muted);
  if (h.post.quality !== settings.quality && !new URLSearchParams(location.search).has('post'))
    h.post.setQuality(settings.quality);

  const close = () => {
    panel.dismiss(); // also takes the title screen down
    if (!started && h.titleSong !== undefined) h.startGameMusic?.();
    started = true;
  };
  const newestSave = async () => {
    const slots = ((await h.screens.saveHandler?.list()) ?? []).filter((s) => s.summary);
    slots.sort((a, b) => b.summary!.savedAt - a.summary!.savedAt);
    return slots[0];
  };
  const refreshSaves = async () => {
    const slot = await newestSave();
    hasSave = !!slot;
    newest = slot?.summary?.gameTime;
  };

  const showMain = (message?: string, focus?: string) =>
    panel.show(mainMenuModel({ started, hasSave, newest }, message), onMain, close, focus);
  const showOptions = (focus?: string) => {
    settings = { ...settings, muted: h.music.isMuted, quality: h.post.quality };
    panel.show(optionsModel(settings), onOptions, () => showMain(undefined, 'options'), focus);
  };

  const onMain = (id: string) => {
    switch (id as MainMenuId) {
      case 'resume':
        close();
        break;
      case 'save':
        close();
        void h.screens.openSaves('save');
        break;
      case 'new':
        try {
          sessionStorage.setItem(SKIP_KEY, h.playIntro ? STORY : '1');
        } catch {
          // the menu will simply show again after the reload
        }
        location.reload();
        break;
      case 'continue':
        void continueGame();
        break;
      case 'load':
        close();
        void h.screens.openSaves('load');
        break;
      case 'intro':
        void replayIntro();
        break;
      case 'options':
        showOptions();
        break;
    }
  };

  const replayIntro = async () => {
    if (!h.playIntro) return;
    panel.dismiss();
    h.music.stop();
    await h.playIntro();
    if (started) h.startGameMusic?.();
    void open();
  };

  const continueGame = async () => {
    const slot = await newestSave();
    if (!slot) return showMain('No saved games');
    const msg = await h.screens.saveHandler!.load(slot.slot).catch((e: Error) => `Failed: ${e.message}`);
    if (msg.startsWith('Failed')) showMain(msg);
    else close();
  };

  const onOptions = (id: string) => {
    switch (id as OptionsId) {
      case 'quality':
        settings = { ...settings, quality: stepQuality(settings.quality) };
        h.post.setQuality(settings.quality);
        h.applyGraphics(false);
        break;
      case 'volDown':
      case 'volUp':
        settings = { ...settings, volume: stepVolume(settings.volume, id === 'volUp' ? 1 : -1) };
        h.music.setVolume(settings.volume);
        break;
      case 'mute':
        settings = { ...settings, muted: !settings.muted };
        h.music.setMuted(settings.muted);
        break;
      case 'fov':
        settings = { ...settings, fov: stepFov(settings.fov) };
        break;
      case 'uiScale':
        settings = { ...settings, uiScale: stepUiScale(settings.uiScale) };
        break;
      case 'mouseLook':
        settings = { ...settings, mouseLook: !settings.mouseLook };
        break;
      case 'controls':
        showControlsMenu(panel, () => showOptions('controls'));
        return;
      case 'keys':
        panel.show(
          keyHelpModel(),
          () => showOptions('keys'),
          () => showOptions('keys'),
        );
        return;
      case 'back':
        showMain(undefined, 'options');
        return;
    }
    persist();
    showOptions(id);
  };

  const open = async () => {
    await refreshSaves();
    // The first menu of a session is the title screen; later Escape menus sit over the game.
    panel.setTitle(started ? undefined : h.titleArt);
    showMain();
    h.screens.open(MENU_SCREEN_ID);
  };

  // Escape opens the menu only if nothing was open before the HUD handled the key.
  let free = false;
  window.addEventListener('keydown', () => (free = !h.screens.blocking), true);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !e.repeat && free && h.canOpen()) void open();
  });

  let skip = false;
  let story = false;
  try {
    const value = sessionStorage.getItem(SKIP_KEY);
    skip = value === '1' || value === STORY || value === 'intro';
    story = value === STORY || value === 'intro';
    sessionStorage.removeItem(SKIP_KEY);
  } catch {
    // no session storage: always show the menu
  }
  let firstLaunch = false;
  try {
    firstLaunch = !localStorage.getItem(INTRO_SEEN_KEY);
  } catch {
    // no storage: treat every launch as a return visit
  }
  // Debug start options (README table) go straight to what they name.
  const params = new URLSearchParams(location.search);
  if (['book', 'cutscene', 'chapter', 'zone'].some((k) => params.has(k))) {
    skip = true;
    story = false;
    firstLaunch = false;
  }
  const titleMusic = () => {
    if (h.titleSong !== undefined)
      void h.music.play(h.titleSong).catch((err) => console.warn('Music unavailable:', err));
  };
  if (skip) {
    started = true;
    if (story && h.playIntro) {
      h.music.stop();
      void h.playIntro(true).then(() => h.startGameMusic?.());
    }
    return Promise.resolve();
  }
  if (firstLaunch && h.playIntro) {
    // The first time the game is started, the introduction plays by itself, then the title menu.
    try {
      localStorage.setItem(INTRO_SEEN_KEY, '1');
    } catch {
      // it will simply play again next time
    }
    h.music.stop();
    void h.playIntro().then(() => {
      titleMusic();
      return open();
    });
    return Promise.resolve();
  }
  titleMusic();
  return open();
}
