import path from 'node:path';

/**
 * Maps a dev-server URL path under `/art/` to a .png inside `root` (the gitignored
 * `art/reference` folder), e.g. `/art/Z01/slots-4x/3.png` -> `<root>/Z01/slots-4x/3.png`.
 * Returns undefined for anything that is not a plain .png inside the root.
 */
export function resolveArtPath(root: string, urlPath: string): string | undefined {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0] ?? '');
  } catch {
    return undefined;
  }
  rel = rel.replace(/^\/+/, '');
  if (!/\.png$/i.test(rel) || rel.includes('\0')) return undefined;
  const base = path.resolve(root);
  const file = path.resolve(base, rel);
  return file.startsWith(base + path.sep) ? file : undefined;
}
