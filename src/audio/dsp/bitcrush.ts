import type { AudioData } from "../data";
import { lowpass } from "./eq";

/**
 * Lo-fi / 8-bit effect. `bits` reduces the number of amplitude steps (16 = off,
 * lower = grittier). `hold` keeps every sample for that many frames, which
 * lowers the effective sample rate (1 = off).
 *
 * `smooth` (0..1) tames the harsh static this effect makes: it filters the sound
 * before it is downsampled (so it doesn't alias) and softens the top end after.
 */
export function bitcrush(a: AudioData, bits: number, hold: number, smooth = 0): AudioData {
  const b = Math.min(Math.max(Math.round(bits), 1), 16);
  const h = Math.max(1, Math.round(hold));
  if (b >= 16 && h === 1) return a;

  const s = Math.min(Math.max(smooth, 0), 1);
  const sr = a.sampleRate;
  let source = a;
  if (s > 0 && h > 1) {
    const full = sr * 0.45;
    source = lowpass(a, full + (sr / (2 * h) - full) * s);
  }

  const levels = Math.pow(2, b - 1);
  const crushed: AudioData = {
    sampleRate: sr,
    channels: source.channels.map((ch) => {
      const out = new Float32Array(ch.length);
      let held = 0;
      for (let i = 0; i < ch.length; i++) {
        if (i % h === 0) held = Math.round(Math.max(-1, Math.min(1, ch[i])) * levels) / levels;
        out[i] = held;
      }
      return out;
    }),
  };

  return s > 0.05 ? lowpass(crushed, 19000 - (19000 - 3500) * s) : crushed;
}
