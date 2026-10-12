import type { AudioData } from "../data";
import { fft } from "./fft";

const FRAME = 1024;
const HOP = 256; // 75% overlap
const BINS = FRAME / 2 + 1;
/** Sum of the squared Hann window at 75% overlap, used to undo the windowing gain. */
const OLA_NORM = 1.5;

const WINDOW = (() => {
  const w = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
  return w;
})();

/**
 * Spectral noise reduction. The noise "fingerprint" is learned automatically from
 * the quietest parts of the clip, then subtracted from every frame. `strength`
 * runs from 0 (nothing) to 1 (aggressive). Works best when the clip has a moment
 * of background noise with no sound on top.
 */
export function spectralDenoise(a: AudioData, strength: number): AudioData {
  const s = Math.min(Math.max(strength, 0), 1);
  if (s < 0.01) return a;
  return { sampleRate: a.sampleRate, channels: a.channels.map((ch) => denoiseChannel(ch, s)) };
}

function denoiseChannel(input: Float32Array, strength: number): Float32Array {
  const n = input.length;
  if (n === 0) return input;

  // Pad so every real sample is covered by four overlapping frames.
  const padded = new Float32Array(n + 2 * FRAME);
  padded.set(input, FRAME);
  const frames = Math.floor((padded.length - FRAME) / HOP) + 1;

  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const load = (f: number) => {
    const start = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = padded[start + i] * WINDOW[i];
      im[i] = 0;
    }
    fft(re, im);
  };

  // Pass 1: analyse every frame (keeping the spectra), then learn the noise from the quietest ones.
  const mags = new Float32Array(frames * BINS);
  const spec = new Float32Array(frames * BINS * 2);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    load(f);
    let e = 0;
    for (let k = 0; k < BINS; k++) {
      const r = re[k];
      const i = im[k];
      const m2 = r * r + i * i;
      mags[f * BINS + k] = Math.sqrt(m2);
      spec[(f * BINS + k) * 2] = r;
      spec[(f * BINS + k) * 2 + 1] = i;
      e += m2;
    }
    energy[f] = e;
  }

  const order = Array.from({ length: frames }, (_, i) => i).sort((x, y) => energy[x] - energy[y]);
  const quiet = order.slice(0, Math.max(4, Math.round(frames * 0.12)));
  const noise = new Float32Array(BINS);
  for (const f of quiet) for (let k = 0; k < BINS; k++) noise[k] += mags[f * BINS + k] / quiet.length;

  // Pass 2: turn down each bin that is close to the noise level.
  const alpha = 1 + 3 * strength;
  const floor = 0.3 - 0.27 * strength;
  const out = new Float32Array(padded.length);
  const gain = new Float32Array(BINS);
  const smooth = new Float32Array(BINS);
  const prev = new Float32Array(BINS).fill(1);

  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < BINS; k++) {
      const m = mags[f * BINS + k];
      gain[k] = Math.max(floor, 1 - (alpha * noise[k]) / (m + 1e-9));
    }
    // Smooth across frequency and let the gain fall slowly over time (avoids "bubbly" artifacts).
    for (let k = 0; k < BINS; k++) {
      const lo = gain[Math.max(k - 1, 0)];
      const hi = gain[Math.min(k + 1, BINS - 1)];
      const g = 0.25 * lo + 0.5 * gain[k] + 0.25 * hi;
      smooth[k] = Math.max(g, prev[k] * 0.7);
      prev[k] = smooth[k];
    }
    for (let k = 0; k < BINS; k++) {
      const r = spec[(f * BINS + k) * 2] * smooth[k];
      const i = spec[(f * BINS + k) * 2 + 1] * smooth[k];
      re[k] = r;
      im[k] = i;
      if (k > 0 && k < BINS - 1) {
        re[FRAME - k] = r;
        im[FRAME - k] = -i; // mirror (conjugate) half so the result is real
      }
    }
    fft(re, im, true);
    const start = f * HOP;
    for (let i = 0; i < FRAME; i++) out[start + i] += (re[i] * WINDOW[i]) / OLA_NORM;
  }

  return out.slice(FRAME, FRAME + n);
}

/**
 * Noise gate: silences the parts quieter than `thresholdDb` and lets louder
 * parts through. Opens quickly and closes smoothly. Off at -80 dB or lower.
 */
export function noiseGate(a: AudioData, thresholdDb: number): AudioData {
  if (thresholdDb <= -79) return a;
  const sr = a.sampleRate;
  const threshold = Math.pow(10, thresholdDb / 20);
  const n = a.channels[0]?.length ?? 0;
  const attack = 1 - Math.exp(-1 / (0.003 * sr));
  const release = 1 - Math.exp(-1 / (0.08 * sr));
  const envDecay = Math.exp(-1 / (0.05 * sr));
  const closedGain = 0.0;

  const gains = new Float32Array(n);
  let env = 0;
  let g = closedGain;
  for (let i = 0; i < n; i++) {
    let level = 0;
    for (const ch of a.channels) level = Math.max(level, Math.abs(ch[i]));
    env = Math.max(level, env * envDecay);
    const target = env >= threshold ? 1 : closedGain;
    g += (target - g) * (target > g ? attack : release);
    gains[i] = g;
  }
  return {
    sampleRate: sr,
    channels: a.channels.map((ch) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = ch[i] * gains[i];
      return out;
    }),
  };
}
