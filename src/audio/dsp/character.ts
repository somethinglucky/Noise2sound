import type { AudioData } from "../data";
import { lowpass } from "./eq";

/**
 * Overdrive. `drive` (0..1) pushes the signal into a soft clipper, adding grit
 * and harmonics; `tone` (0..1) is how bright the result stays (0 = dark, 1 = bright).
 */
export function distort(a: AudioData, drive: number, tone: number): AudioData {
  const d = Math.min(Math.max(drive, 0), 1);
  if (d < 0.01) return a;
  const gain = 1 + 29 * d;
  const driven: AudioData = {
    sampleRate: a.sampleRate,
    channels: a.channels.map((ch) => {
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) out[i] = Math.tanh(gain * ch[i]) * 0.7;
      return out;
    }),
  };
  const t = Math.min(Math.max(tone, 0), 1);
  return lowpass(driven, 1200 * Math.pow(15, t));
}

/**
 * Robot voice (ring modulation). Multiplies the sound by a tone at `freq` Hz,
 * giving a metallic, alien quality. `mix` blends it with the original.
 */
export function robot(a: AudioData, freq: number, mix: number): AudioData {
  const m = Math.min(Math.max(mix, 0), 1);
  if (m < 0.01) return a;
  const step = (2 * Math.PI * Math.max(freq, 1)) / a.sampleRate;
  return {
    sampleRate: a.sampleRate,
    channels: a.channels.map((ch) => {
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) out[i] = ch[i] * (1 - m + m * Math.sin(step * i));
      return out;
    }),
  };
}

/** How long the echoes keep going after the sound ends, in seconds (at most 4). */
export function echoTailSeconds(time: number, feedback: number): number {
  const fb = Math.min(Math.max(feedback, 0), 0.9);
  const repeats = fb < 0.05 ? 1 : Math.ceil(Math.log(0.01) / Math.log(fb));
  return Math.min(time * repeats, 4);
}

/**
 * Echo / delay. `time` is the gap between repeats in seconds, `feedback` (0..0.9)
 * how much of each repeat feeds the next, `mix` how loud the echoes are.
 * The output is longer than the input by the echo tail.
 */
export function echo(a: AudioData, time: number, feedback: number, mix: number): AudioData {
  const m = Math.min(Math.max(mix, 0), 1);
  if (m < 0.01) return a;
  const sr = a.sampleRate;
  const delay = Math.max(1, Math.round(time * sr));
  const fb = Math.min(Math.max(feedback, 0), 0.9);
  const tail = Math.round(echoTailSeconds(time, fb) * sr);
  const n = (a.channels[0]?.length ?? 0) + tail;

  return {
    sampleRate: sr,
    channels: a.channels.map((ch) => {
      const buf = new Float32Array(delay);
      const out = new Float32Array(n);
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const x = i < ch.length ? ch[i] : 0;
        const delayed = buf[idx];
        out[i] = x + m * delayed;
        buf[idx] = x + fb * delayed;
        if (++idx >= delay) idx = 0;
      }
      return out;
    }),
  };
}
