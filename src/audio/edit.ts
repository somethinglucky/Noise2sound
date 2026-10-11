import { type AudioData, lengthSamples } from "./data";

/** Convert seconds to a sample index, clamped to the clip. */
export function toSample(a: AudioData, seconds: number): number {
  const i = Math.round(seconds * a.sampleRate);
  return Math.min(Math.max(i, 0), lengthSamples(a));
}

function sliceSamples(a: AudioData, from: number, to: number): AudioData {
  return {
    sampleRate: a.sampleRate,
    channels: a.channels.map((ch) => ch.slice(from, to)),
  };
}

/** The part between start and end (seconds). Used by Copy and Trim. */
export function slice(a: AudioData, startSec: number, endSec: number): AudioData {
  const from = toSample(a, Math.min(startSec, endSec));
  const to = toSample(a, Math.max(startSec, endSec));
  return sliceSamples(a, from, to);
}

/** Everything except the part between start and end. Used by Cut and Delete. */
export function remove(a: AudioData, startSec: number, endSec: number): AudioData {
  const from = toSample(a, Math.min(startSec, endSec));
  const to = toSample(a, Math.max(startSec, endSec));
  const channels = a.channels.map((ch) => {
    const out = new Float32Array(ch.length - (to - from));
    out.set(ch.subarray(0, from), 0);
    out.set(ch.subarray(to), from);
    return out;
  });
  return { sampleRate: a.sampleRate, channels };
}

/**
 * Insert `clip` into `a` at `atSec`. If the channel counts differ, the clip is
 * adapted (mono is copied to every channel, extra channels are dropped).
 */
export function insert(a: AudioData, atSec: number, clip: AudioData): AudioData {
  const at = toSample(a, atSec);
  const channels = a.channels.map((ch, c) => {
    const src = clip.channels[Math.min(c, clip.channels.length - 1)];
    const out = new Float32Array(ch.length + src.length);
    out.set(ch.subarray(0, at), 0);
    out.set(src, at);
    out.set(ch.subarray(at), at + src.length);
    return out;
  });
  return { sampleRate: a.sampleRate, channels };
}
