import { SoundTouch } from "@soundtouchjs/core";
import { type AudioData, lengthSamples } from "../data";

/**
 * Resample by `ratio` using linear interpolation. ratio 2 plays twice as fast
 * (half the length, one octave up); ratio 0.5 is half speed (double length, one
 * octave down). Pitch and duration change together, like a tape speed change.
 */
export function resample(a: AudioData, ratio: number): AudioData {
  if (ratio === 1) return a;
  const n = lengthSamples(a);
  const outLen = Math.max(1, Math.round(n / ratio));
  const channels = a.channels.map((ch) => {
    const out = new Float32Array(outLen);
    const last = ch.length - 1;
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.min(Math.floor(pos), last);
      const i1 = Math.min(i0 + 1, last);
      const frac = pos - i0;
      out[i] = ch[i0] * (1 - frac) + ch[i1] * frac;
    }
    return out;
  });
  return { sampleRate: a.sampleRate, channels };
}

const CHUNK = 4096;

/** Run interleaved stereo frames through SoundTouch at a pitch shift. Returns left and right. */
function shiftStereo(left: Float32Array, right: Float32Array, sampleRate: number, semitones: number) {
  const n = left.length;
  const st = new SoundTouch({ sampleRate });
  st.pitchSemitones = semitones;

  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  let written = 0;
  const input = new Float32Array(CHUNK * 2);
  const pulled = new Float32Array(CHUNK * 8);

  const pull = () => {
    while (st.outputBuffer.frameCount > 0 && written < n) {
      const frames = Math.min(st.outputBuffer.frameCount, CHUNK * 4, n - written);
      st.outputBuffer.extract(pulled, 0, frames);
      st.outputBuffer.receive(frames);
      for (let i = 0; i < frames; i++) {
        outL[written + i] = pulled[2 * i];
        outR[written + i] = pulled[2 * i + 1];
      }
      written += frames;
    }
  };

  // Feed the clip, then silence so the last part of the sound is flushed out.
  const total = n + CHUNK * 8;
  for (let pos = 0; pos < total && written < n; pos += CHUNK) {
    const frames = Math.min(CHUNK, total - pos);
    for (let i = 0; i < frames; i++) {
      const src = pos + i;
      input[2 * i] = src < n ? left[src] : 0;
      input[2 * i + 1] = src < n ? right[src] : 0;
    }
    st.inputBuffer.putSamples(input, 0, frames);
    st.process();
    pull();
  }
  return { left: outL, right: outR };
}

/**
 * Shift pitch by `semitones` without changing the duration. Stereo clips are
 * processed as a pair, any other channel count one channel at a time.
 */
export function pitchShift(a: AudioData, semitones: number): AudioData {
  if (Math.abs(semitones) < 0.005) return a;
  const sr = a.sampleRate;

  if (a.channels.length === 2) {
    const { left, right } = shiftStereo(a.channels[0], a.channels[1], sr, semitones);
    return { sampleRate: sr, channels: [left, right] };
  }

  const channels = a.channels.map((ch) => shiftStereo(ch, ch, sr, semitones).left);
  return { sampleRate: sr, channels };
}
