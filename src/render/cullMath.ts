/** Pure helpers for splitting billboards into spatial chunks and culling chunks by distance. */

/** Edge of a billboard chunk in render-space world units. */
export const CHUNK_SIZE = 32;

export const BILLBOARD_STRIDE = 5;

/**
 * Split billboard data (5 floats per instance: x, y, z, width, height) into square ground-plane
 * chunks so each chunk can be frustum- and distance-culled on its own. Instance order inside a
 * chunk follows the input order, and chunks come out in first-seen order.
 */
export function chunkBillboards(data: number[], chunkSize = CHUNK_SIZE): number[][] {
  const chunks = new Map<string, number[]>();
  for (let i = 0; i < data.length; i += BILLBOARD_STRIDE) {
    const key = `${Math.floor(data[i]! / chunkSize)},${Math.floor(data[i + 2]! / chunkSize)}`;
    let list = chunks.get(key);
    if (!list) chunks.set(key, (list = []));
    for (let k = 0; k < BILLBOARD_STRIDE; k++) list.push(data[i + k]!);
  }
  return [...chunks.values()];
}

/** True when a sphere (centre cx, cz on the ground plane, radius r) lies entirely beyond `far` from the eye. */
export function beyondFar(eyeX: number, eyeZ: number, cx: number, cz: number, r: number, far: number): boolean {
  const dx = cx - eyeX;
  const dz = cz - eyeZ;
  const reach = far + r;
  return dx * dx + dz * dz > reach * reach;
}
