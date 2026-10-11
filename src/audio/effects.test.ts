import { describe, expect, it } from "vitest";
import { type AudioData, lengthSamples } from "./data";
import { bitcrush } from "./dsp/bitcrush";
import { eq3 } from "./dsp/eq";
import { pitchShift, resample } from "./dsp/pitch";
import { reverb, reverbTailSeconds } from "./dsp/reverb";
import { applyEffects, cloneEffects, DEFAULT_EFFECTS, isNeutral, PRESETS } from "./effects";

const SR = 44100;

function sine(freq: number, seconds: number, amp = 0.5, channels = 1): AudioData {
  const n = Math.round(seconds * SR);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return { sampleRate: SR, channels: Array.from({ length: channels }, () => ch.slice()) };
}

function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
}

/** Estimate frequency from upward zero crossings in the middle of the clip. */
function freq(x: Float32Array): number {
  const from = Math.floor(x.length * 0.3);
  const to = Math.floor(x.length * 0.7);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++;
  return crossings / ((to - from) / SR);
}

const db = (x: number) => 20 * Math.log10(x);

describe("resample", () => {
  it("changes length and pitch together", () => {
    const out = resample(sine(300, 1), 2);
    expect(lengthSamples(out)).toBe(SR / 2);
    expect(freq(out.channels[0])).toBeCloseTo(600, -1);
  });

  it("ratio 1 returns the same audio", () => {
    const a = sine(300, 0.1);
    expect(resample(a, 1)).toBe(a);
  });
});

describe("pitchShift", () => {
  it("shifts up an octave and keeps the length", () => {
    const out = pitchShift(sine(300, 1), 12);
    expect(lengthSamples(out)).toBe(SR);
    expect(freq(out.channels[0])).toBeGreaterThan(580);
    expect(freq(out.channels[0])).toBeLessThan(620);
  });

  it("shifts down a fifth", () => {
    const out = pitchShift(sine(300, 1), -7);
    expect(freq(out.channels[0])).toBeGreaterThan(190);
    expect(freq(out.channels[0])).toBeLessThan(210);
  });

  it("keeps the start of the sound", () => {
    const out = pitchShift(sine(300, 1, 0.6), 7);
    expect(rms(out.channels[0], 0, 441)).toBeGreaterThan(0.3);
  });

  it("handles stereo", () => {
    const out = pitchShift(sine(300, 0.5, 0.5, 2), 5);
    expect(out.channels.length).toBe(2);
    expect(lengthSamples(out)).toBe(SR / 2);
  });

  it("zero shift is a no-op", () => {
    const a = sine(300, 0.1);
    expect(pitchShift(a, 0)).toBe(a);
  });
});

describe("eq3", () => {
  it("boosts lows with the low shelf and leaves highs alone", () => {
    const low = eq3(sine(80, 1), 12, 0, 0).channels[0];
    const high = eq3(sine(10000, 1), 12, 0, 0).channels[0];
    const gainLow = db(rms(low, 20000) / rms(sine(80, 1).channels[0], 20000));
    const gainHigh = db(rms(high, 20000) / rms(sine(10000, 1).channels[0], 20000));
    expect(gainLow).toBeGreaterThan(9);
    expect(gainLow).toBeLessThan(13);
    expect(Math.abs(gainHigh)).toBeLessThan(1);
  });

  it("boosts and cuts the mids at 1 kHz", () => {
    const ref = rms(sine(1000, 1).channels[0], 20000);
    expect(db(rms(eq3(sine(1000, 1), 0, 9, 0).channels[0], 20000) / ref)).toBeGreaterThan(7);
    expect(db(rms(eq3(sine(1000, 1), 0, -9, 0).channels[0], 20000) / ref)).toBeLessThan(-7);
  });

  it("cuts highs with the high shelf", () => {
    const ref = rms(sine(12000, 1).channels[0], 20000);
    expect(db(rms(eq3(sine(12000, 1), 0, 0, -12).channels[0], 20000) / ref)).toBeLessThan(-9);
  });

  it("flat settings are a no-op", () => {
    const a = sine(300, 0.1);
    expect(eq3(a, 0, 0, 0)).toBe(a);
  });
});

describe("bitcrush", () => {
  it("limits the number of distinct levels", () => {
    const out = bitcrush(sine(300, 0.5), 3, 1).channels[0];
    const levels = new Set(Array.from(out));
    expect(levels.size).toBeLessThanOrEqual(8);
  });

  it("holds samples for the downsample factor", () => {
    const out = bitcrush(sine(300, 0.1), 16, 4).channels[0];
    for (let i = 0; i + 3 < 400; i += 4) {
      expect(out[i + 1]).toBe(out[i]);
      expect(out[i + 3]).toBe(out[i]);
    }
  });

  it("16 bits and no hold is a no-op", () => {
    const a = sine(300, 0.1);
    expect(bitcrush(a, 16, 1)).toBe(a);
  });
});

describe("reverb", () => {
  it("mix 0 returns the input untouched", () => {
    const a = sine(300, 0.1);
    expect(reverb(a, 0.5, 0.5, 0)).toBe(a);
  });

  it("adds a tail after the sound ends", () => {
    const click: AudioData = { sampleRate: SR, channels: [new Float32Array(SR / 10)] };
    click.channels[0][0] = 1;
    const out = reverb(click, 0.6, 0.5, 0.5);
    expect(lengthSamples(out)).toBe(SR / 10 + Math.round(reverbTailSeconds(0.6) * SR));
    // there is energy well after the original click
    expect(rms(out.channels[0], SR / 10 + 1000, SR / 10 + 5000)).toBeGreaterThan(0.0005);
  });

  it("stays stable and at a sane loudness", () => {
    const out = reverb(sine(220, 1, 0.5), 1, 0.2, 1).channels[0];
    let peak = 0;
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeLessThan(2);
    expect(rms(out, 30000, 40000)).toBeGreaterThan(0.05);
  });

  it("bigger rooms ring longer", () => {
    const click = (size: number) => {
      const a: AudioData = { sampleRate: SR, channels: [new Float32Array(2000)] };
      a.channels[0][0] = 1;
      const out = reverb(a, size, 0.3, 0.5).channels[0];
      return rms(out, 30000, 40000);
    };
    expect(click(0.9)).toBeGreaterThan(click(0.2));
  });
});

describe("applyEffects", () => {
  it("returns the input when everything is off", () => {
    const a = sine(300, 0.1);
    expect(isNeutral(DEFAULT_EFFECTS)).toBe(true);
    expect(applyEffects(a, DEFAULT_EFFECTS)).toBe(a);
  });

  it("speed changes the length but keeps the pitch", () => {
    const p = cloneEffects(DEFAULT_EFFECTS);
    p.speed = { on: true, factor: 2 };
    const out = applyEffects(sine(300, 1), p);
    expect(Math.abs(lengthSamples(out) - SR / 2)).toBeLessThan(SR * 0.03);
    expect(freq(out.channels[0])).toBeGreaterThan(280);
    expect(freq(out.channels[0])).toBeLessThan(320);
  });

  it("slower speed lengthens the clip", () => {
    const p = cloneEffects(DEFAULT_EFFECTS);
    p.speed = { on: true, factor: 0.5 };
    const out = applyEffects(sine(300, 1), p);
    expect(Math.abs(lengthSamples(out) - SR * 2)).toBeLessThan(SR * 0.05);
  });

  it("pitch changes pitch but keeps the length", () => {
    const p = cloneEffects(DEFAULT_EFFECTS);
    p.pitch = { on: true, semitones: 12 };
    const out = applyEffects(sine(300, 1), p);
    expect(lengthSamples(out)).toBe(SR);
    expect(freq(out.channels[0])).toBeGreaterThan(580);
  });

  it("cuts the result off at the maximum length", () => {
    const p = cloneEffects(DEFAULT_EFFECTS);
    p.reverb = { on: true, size: 1, damp: 0.5, mix: 0.5 };
    const out = applyEffects(sine(300, 1), p, 1.5);
    expect(lengthSamples(out)).toBe(Math.floor(1.5 * SR));
  });

  it("every preset runs and produces finite audio", () => {
    const a = sine(220, 0.5);
    for (const preset of PRESETS) {
      expect(isNeutral(preset.params)).toBe(false);
      const out = applyEffects(a, preset.params, 15);
      for (const v of out.channels[0]) {
        if (!Number.isFinite(v)) throw new Error(`${preset.id} produced a non-finite sample`);
      }
    }
  });

  it("does not modify the input", () => {
    const a = sine(300, 0.2);
    const copy = a.channels[0].slice();
    const p = cloneEffects(PRESETS[0].params);
    applyEffects(a, p);
    expect(Array.from(a.channels[0])).toEqual(Array.from(copy));
  });
});
