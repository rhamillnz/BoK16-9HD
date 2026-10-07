export type PostQuality = 'low' | 'medium' | 'high';

export const POST_QUALITIES: readonly PostQuality[] = ['low', 'medium', 'high'];

export interface PostSettings {
  /** Route through the PostProcessing pipeline at all; false renders straight to the canvas. */
  enabled: boolean;
  bloom: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  ao: boolean;
  /** GTAO runs at this fraction of the output resolution. */
  aoResolutionScale: number;
  aoSamples: number;
  aoRadius: number;
  aoIntensity: number;
  fxaa: boolean;
  grade: boolean;
  /** Colour grade, applied in linear light before tone mapping. */
  saturation: number;
  contrast: number;
  /** Multiplies shadows towards cool, highlights towards warm (0 = neutral). */
  splitTone: number;
  vignette: number;
}

export const POST_PRESETS: Record<PostQuality, PostSettings> = {
  low: {
    enabled: false, bloom: false, bloomStrength: 0, bloomRadius: 0, bloomThreshold: 1,
    ao: false, aoResolutionScale: 0.5, aoSamples: 8, aoRadius: 0.5, aoIntensity: 1,
    fxaa: false, grade: false, saturation: 1, contrast: 1, splitTone: 0, vignette: 0,
  },
  medium: {
    enabled: true, bloom: true, bloomStrength: 0.18, bloomRadius: 0.5, bloomThreshold: 0.9,
    ao: false, aoResolutionScale: 0.5, aoSamples: 8, aoRadius: 0.5, aoIntensity: 1,
    fxaa: true, grade: true, saturation: 1.1, contrast: 1.02, splitTone: 0.3, vignette: 0.1,
  },
  high: {
    enabled: true, bloom: true, bloomStrength: 0.22, bloomRadius: 0.6, bloomThreshold: 0.85,
    ao: true, aoResolutionScale: 0.5, aoSamples: 12, aoRadius: 0.6, aoIntensity: 0.8,
    fxaa: true, grade: true, saturation: 1.1, contrast: 1.02, splitTone: 0.3, vignette: 0.1,
  },
};

export function nextQuality(q: PostQuality): PostQuality {
  return POST_QUALITIES[(POST_QUALITIES.indexOf(q) + 1) % POST_QUALITIES.length]!;
}

/** Parses a ?post= value; anything unrecognised falls back to `fallback`. */
export function parseQuality(value: string | null | undefined, fallback: PostQuality): PostQuality {
  return POST_QUALITIES.find((q) => q === value) ?? fallback;
}
