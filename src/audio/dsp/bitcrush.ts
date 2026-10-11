import type { AudioData } from "../data";

/**
 * Lo-fi / 8-bit effect. `bits` reduces the number of amplitude steps (16 = off,
 * lower = grittier). `hold` keeps every sample for that many frames, which
 * lowers the effective sample rate (1 = off).
 */
export function bitcrush(a: AudioData, bits: number, hold: number): AudioData {
  const b = Math.min(Math.max(Math.round(bits), 1), 16);
  const h = Math.max(1, Math.round(hold));
  if (b >= 16 && h === 1) return a;

  const levels = Math.pow(2, b - 1);
  return {
    sampleRate: a.sampleRate,
    channels: a.channels.map((ch) => {
      const out = new Float32Array(ch.length);
      let held = 0;
      for (let i = 0; i < ch.length; i++) {
        if (i % h === 0) held = Math.round(Math.max(-1, Math.min(1, ch[i])) * levels) / levels;
        out[i] = held;
      }
      return out;
    }),
  };
}
