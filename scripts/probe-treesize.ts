import { readFileSync } from 'node:fs';
import { ResourceArchive } from '../src/formats/archive';
import { loadZone } from '../src/world/zone';
const D = 'C:/Program Files (x86)/GOG Galaxy/Games/Betrayal at Krondor';
const a = new ResourceArchive(readFileSync(`${D}/KRONDOR.RMF`), readFileSync(`${D}/KRONDOR.001`));
const z = loadZone(a, 1);
const out: Record<string, { slot: number; height: number; width: number; count: number }> = {};
z.table.models.forEach((m, i) => {
  if (!m?.sprite || !m.name.startsWith('tree')) return;
  const img = z.slotImages[m.sprite.index]!;
  const sf = m.sprite.scale === 0 ? 256 : m.sprite.scale;
  const major = ((2 * m.radius * sf) / 256) * m.scale;
  const maxDim = Math.max(img.width, img.height);
  out[m.name] = {
    slot: m.sprite.index,
    height: +(((img.height / maxDim) * major * 1.2) / 100).toFixed(2),
    width: +(((img.width / maxDim) * major) / 100).toFixed(2),
    count: z.items.filter((it) => it.type === i).length,
  };
});
console.log(JSON.stringify(out, null, 1));
