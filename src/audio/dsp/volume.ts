import type { AudioData } from "../data";

/** Target peak for Normalize: -1 dBFS. */
export const NORMALIZE_PEAK = 0.891;
const KNEE = 0.8;
/** The limiter never goes above this, leaving headroom below digital full scale. */
const CEILING = 0.98;

/** Gentle limiter: unchanged below the knee, smoothly squeezed above it, never reaches the ceiling. */
export function softLimit(x: number): number {
  const ax = Math.abs(x);
  if (ax <= KNEE) return x;
  const y = KNEE + (CEILING - KNEE) * Math.tanh((ax - KNEE) / (CEILING - KNEE));
  return x < 0 ? -y : y;
}

export function peakOf(a: AudioData): number {
  let peak = 0;
  for (const ch of a.channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  return peak;
}

/**
 * Make it louder or quieter. `normalize` first scales the clip so its loudest
 * point sits just under full scale; `db` is then added on top. A soft limiter
 * stops boosts from clipping harshly.
 */
export function applyVolume(a: AudioData, db: number, normalize: boolean): AudioData {
  let gain = Math.pow(10, db / 20);
  if (normalize) {
    const peak = peakOf(a);
    if (peak > 1e-6) gain *= NORMALIZE_PEAK / peak;
  }
  if (Math.abs(gain - 1) < 1e-4) return a;
  return {
    sampleRate: a.sampleRate,
    channels: a.channels.map((ch) => {
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) out[i] = softLimit(ch[i] * gain);
      return out;
    }),
  };
}
