import '@fontsource/cinzel/700.css';

/** Load the Cinzel 700 weight font and resolve when ready. */
export async function loadSpeakerFont(): Promise<void> {
  if (typeof document === 'undefined') return;
  // Request the specific font size that will be used. Browsers cache the result.
  await document.fonts.load('700 32px Cinzel');
}

/** Measure text width with Cinzel font at a given pixel size (assuming browser font APIs work). */
export function measureSpeakerName(text: string, pixelSize: number): number {
  if (typeof document === 'undefined') return text.length * pixelSize * 0.5; // fallback
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return text.length * pixelSize * 0.5;
  ctx.font = `700 ${pixelSize}px Cinzel, Georgia, serif`;
  return ctx.measureText(text).width;
}

/**
 * Fit speaker name to box width by reducing the font size if needed.
 * Returns the font size (in pixels) to use and a boolean indicating whether it fits.
 */
export function fitSpeakerName(text: string, maxWidth: number, maxSize: number): { size: number; fits: boolean } {
  let size = maxSize;
  while (size > 8 && measureSpeakerName(text, size) > maxWidth) {
    size--;
  }
  const fits = measureSpeakerName(text, size) <= maxWidth;
  return { size: Math.max(8, size), fits };
}

/** Draw speaker name with Cinzel font, with outline and fill. */
export function drawSpeakerName(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fillColor: string,
  outlineColor: string,
  outlineWidth: number,
): void {
  ctx.font = `700 ${size}px Cinzel, Georgia, serif`;
  ctx.fillStyle = outlineColor;
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = outlineWidth;

  // Measure for horizontal centering adjustment
  const metrics = ctx.measureText(text);
  const actualX = x - metrics.width / 2;

  // Draw outline with stroke
  ctx.strokeText(text, actualX, y, metrics.width);

  // Draw fill
  ctx.fillStyle = fillColor;
  ctx.fillText(text, actualX, y);
}
