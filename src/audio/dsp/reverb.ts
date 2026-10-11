import type { AudioData } from "../data";

// Freeverb tunings (in samples at 44.1 kHz).
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;
const FIXED_GAIN = 0.015;
/** Brings the wet signal to about the same loudness as the dry one at mix 1. */
const WET_SCALE = 3;

class Comb {
  private buf: Float32Array;
  private idx = 0;
  private store = 0;
  constructor(size: number, private feedback: number, private damp: number) {
    this.buf = new Float32Array(size);
  }
  process(x: number): number {
    const out = this.buf[this.idx];
    this.store = out * (1 - this.damp) + this.store * this.damp;
    this.buf[this.idx] = x + this.store * this.feedback;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return out;
  }
}

class Allpass {
  private buf: Float32Array;
  private idx = 0;
  constructor(size: number) {
    this.buf = new Float32Array(size);
  }
  process(x: number): number {
    const bufOut = this.buf[this.idx];
    const out = -x + bufOut;
    this.buf[this.idx] = x + bufOut * 0.5;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return out;
  }
}

/** How long the reverb keeps ringing after the sound ends, in seconds. */
export function reverbTailSeconds(size: number): number {
  return 0.4 + 2.6 * Math.min(Math.max(size, 0), 1);
}

/**
 * Freeverb-style reverb. `size` (0..1) is the room size, `damp` (0..1) how fast
 * high frequencies die away, `mix` (0..1) the wet/dry balance. The output is
 * longer than the input by the reverb tail.
 */
export function reverb(a: AudioData, size: number, damp: number, mix: number): AudioData {
  const m = Math.min(Math.max(mix, 0), 1);
  if (m < 0.005) return a;

  const sr = a.sampleRate;
  const scale = sr / 44100;
  const feedback = 0.7 + 0.28 * Math.min(Math.max(size, 0), 1);
  const dampening = 0.4 * Math.min(Math.max(damp, 0), 1);
  const tail = Math.round(reverbTailSeconds(size) * sr);
  const n = (a.channels[0]?.length ?? 0) + tail;

  const channels = a.channels.map((ch, c) => {
    const spread = c % 2 === 1 ? STEREO_SPREAD : 0;
    const combs = COMB_TUNING.map((t) => new Comb(Math.round((t + spread) * scale), feedback, dampening));
    const allpasses = ALLPASS_TUNING.map((t) => new Allpass(Math.round((t + spread) * scale)));

    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dry = i < ch.length ? ch[i] : 0;
      const input = dry * FIXED_GAIN;
      let wet = 0;
      for (const comb of combs) wet += comb.process(input);
      for (const ap of allpasses) wet = ap.process(wet);
      out[i] = dry * (1 - m) + wet * WET_SCALE * m;
    }
    return out;
  });

  return { sampleRate: sr, channels };
}
