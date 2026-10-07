import { mountHud } from '../../ui/hud';
import { parseFNT } from '../../formats/fnt';
import { parseBMX } from '../../formats/bmx';
import { parsePalette } from '../../formats/palette';
import { parseObjInfo } from '../../formats/objinfo';
import { loadItemIcons } from '../../data/itemIcons';
import { ResourceArchive } from '../../formats/archive';
import { portraitCanvases } from '../../ui/partyBar';

export function setupUI(archive: ResourceArchive, save: any) {
  const screens = mountHud(document.body, {
    font: parseFNT(archive.get('GAME.FNT')),
    save,
    items: parseObjInfo(archive.get('OBJINFO.DAT')).items,
    icons: loadItemIcons(archive),
    portraits: portraitCanvases(parseBMX(archive.get('HEADS.BMX')), parsePalette(archive.get('OPTIONS.PAL'))),
  });
  return screens;
}
