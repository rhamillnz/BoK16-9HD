/**
 * Weather ambience, synthesised (no sound files): rain is looping noise band-passed to a hiss,
 * wind is looping noise through a low band-pass whose gain and pitch drift slowly. Levels follow
 * the shared weather amounts; M mutes it together with the music.
 */

export interface WeatherAmounts {
  rain: number;
  overcast: number;
  mist: number;
}

export interface AmbienceLevels {
  /** Gain of the rain layer (0..RAIN_MAX). */
  rain: number;
  /** Gain of the wind layer (0..WIND_MAX). */
  wind: number;
}

export const RAIN_MAX = 0.22;
export const WIND_MAX = 0.16;

/** Layer gains for the weather: rain scales with the rain amount; wind rises with overcast and mist, and a little with rain. */
export function ambienceLevels(w: WeatherAmounts, underground = false): AmbienceLevels {
  if (underground) return { rain: 0, wind: 0 };
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const wind = clamp(Math.max(w.overcast * 0.55, w.mist * 0.4) + w.rain * 0.35);
  return { rain: clamp(w.rain) * RAIN_MAX, wind: wind * WIND_MAX };
}

export class WeatherAmbience {
  private readonly ctx = new AudioContext();
  private readonly master = this.ctx.createGain();
  private readonly rainGain = this.ctx.createGain();
  private readonly windGain = this.ctx.createGain();
  private muted = false;
  private vol: number;

  constructor(volume = 0.8) {
    this.vol = volume;
    this.master.gain.value = volume;
    this.master.connect(this.ctx.destination);
    this.rainGain.gain.value = 0;
    this.windGain.gain.value = 0;

    const noise = (seconds: number, smooth: number): AudioBufferSourceNode => {
      const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * seconds), this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        // smooth = 0: white; towards 1: duller (one-pole low-pass of white noise).
        last = last * smooth + (Math.random() * 2 - 1) * (1 - smooth);
        data[i] = last * (smooth > 0 ? 1 / (1 - smooth) ** 0.5 : 1);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      return src;
    };

    // Rain: hiss between ~700 Hz and 8 kHz.
    const rain = noise(3, 0.1);
    const rainHi = this.ctx.createBiquadFilter();
    rainHi.type = 'highpass';
    rainHi.frequency.value = 700;
    const rainLo = this.ctx.createBiquadFilter();
    rainLo.type = 'lowpass';
    rainLo.frequency.value = 8000;
    rain.connect(rainHi).connect(rainLo).connect(this.rainGain).connect(this.master);
    rain.start();

    // Wind: dull noise, band-passed low, with a slow gain and pitch drift.
    const wind = noise(4, 0.9);
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 380;
    band.Q.value = 0.7;
    const gust = this.ctx.createGain();
    gust.gain.value = 0.75;
    wind.connect(band).connect(gust).connect(this.windGain).connect(this.master);
    wind.start();
    for (const [rate, depth, target] of [
      [0.11, 0.25, gust.gain],
      [0.07, 140, band.frequency],
    ] as const) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = rate;
      const amount = this.ctx.createGain();
      amount.gain.value = depth;
      lfo.connect(amount).connect(target);
      lfo.start();
    }

    // Browsers keep the context suspended until a gesture.
    const resume = () => {
      void this.ctx.resume();
      for (const type of ['pointerdown', 'keydown']) document.removeEventListener(type, resume);
    };
    for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, resume);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.master.gain.value = muted ? 0 : this.vol;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Follow the weather; call every frame (levels are smoothed by the audio engine). */
  update(amounts: WeatherAmounts, underground: boolean): void {
    const l = ambienceLevels(amounts, underground);
    const now = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(l.rain, now, 0.6);
    this.windGain.gain.setTargetAtTime(l.wind, now, 0.9);
  }
}
