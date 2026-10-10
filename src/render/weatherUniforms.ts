import { uniform } from 'three/tsl';

/**
 * The current weather as 0..1 amounts, shared by the sky (clouds, sun, fog), the rain streaks and the
 * wet road. weather.ts eases these towards the preset every frame; all zero is a clear day.
 */
export const weatherLight = {
  /** Rain streaks: fraction of the drops drawn. */
  rain: uniform(0),
  /** Cloud cover and darkening, grey sky, dimmer sun. */
  overcast: uniform(0),
  /** Fog pulled in close. */
  mist: uniform(0),
  /** Wet ground: darker, glossier road. */
  wet: uniform(0),
};
