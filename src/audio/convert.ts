import { type AudioData, lengthSamples } from "./data";
import { lowpass } from "./dsp/eq";
import { resample } from "./dsp/pitch";

/** Mix all channels down to one. */
export function toMono(a: AudioData): AudioData {
  if (a.channels.length <= 1) return a;
  const n = lengthSamples(a);
  const out = new Float32Array(n);
  for (const ch of a.channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  const scale = 1 / a.channels.length;
  for (let i = 0; i < n; i++) out[i] *= scale;
  return { sampleRate: a.sampleRate, channels: [out] };
}

/**
 * Change the sample rate while keeping the same sound and duration. When going
 * lower, the top end is filtered off first so it doesn't alias.
 */
export function convertSampleRate(a: AudioData, targetRate: number): AudioData {
  if (targetRate === a.sampleRate || targetRate <= 0) return a;
  const source = targetRate < a.sampleRate ? lowpass(a, targetRate * 0.45) : a;
  const converted = resample(source, a.sampleRate / targetRate);
  return { sampleRate: targetRate, channels: converted.channels };
}

/**
 * Cut silence from the start and end of the clip. Anything quieter than
 * `thresholdDb` counts as silence; a few milliseconds are kept either side.
 */
export function trimSilence(a: AudioData, thresholdDb = -60, keepMs = 10): AudioData {
  const n = lengthSamples(a);
  const threshold = Math.pow(10, thresholdDb / 20);
  const loud = (i: number) => a.channels.some((ch) => Math.abs(ch[i]) > threshold);

  let first = 0;
  while (first < n && !loud(first)) first++;
  if (first === n) return a; // all silence: leave it alone
  let last = n - 1;
  while (last > first && !loud(last)) last--;

  const keep = Math.round((keepMs / 1000) * a.sampleRate);
  const from = Math.max(0, first - keep);
  const to = Math.min(n, last + 1 + keep);
  if (from === 0 && to === n) return a;
  return { sampleRate: a.sampleRate, channels: a.channels.map((ch) => ch.slice(from, to)) };
}

/** Fade the very start and end by a few milliseconds so the file doesn't click when it plays. */
export function softEdges(a: AudioData, ms = 5): AudioData {
  const n = lengthSamples(a);
  const len = Math.min(Math.round((ms / 1000) * a.sampleRate), Math.floor(n / 2));
  if (len < 2) return a;
  return {
    sampleRate: a.sampleRate,
    channels: a.channels.map((ch) => {
      const out = ch.slice();
      for (let i = 0; i < len; i++) {
        const g = i / len;
        out[i] *= g;
        out[n - 1 - i] *= g;
      }
      return out;
    }),
  };
}
