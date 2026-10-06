/**
 * Best-effort palette choice for viewing an image outside game context.
 * The real game picks palettes per scene; this heuristic is for the viewer only.
 */
export function guessPalette(imageName: string, allNames: readonly string[]): string {
  const pals = allNames.filter((n) => n.endsWith('.PAL'));
  const base = imageName.replace(/\.[^.]+$/, '');
  const exact = `${base}.PAL`;
  if (pals.includes(exact)) return exact;
  // Longest shared prefix wins, e.g. Z01SLOT0.BMX -> Z01.PAL.
  let best = '';
  let bestLen = 0;
  for (const p of pals) {
    const pb = p.replace(/\.PAL$/, '');
    let n = 0;
    while (n < pb.length && n < base.length && pb[n] === base[n]) n++;
    if (n === pb.length && n > bestLen) {
      best = p;
      bestLen = n;
    }
  }
  if (best) return best;
  return pals.includes('OPTIONS.PAL') ? 'OPTIONS.PAL' : pals[0]!;
}
