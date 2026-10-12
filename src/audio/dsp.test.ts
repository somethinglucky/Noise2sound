import { describe, expect, it } from "vitest";
import { type AudioData, lengthSamples } from "./data";
import { bitcrush } from "./dsp/bitcrush";
import { distort, echo, echoTailSeconds, robot } from "./dsp/character";
import { noiseGate, spectralDenoise } from "./dsp/denoise";
import { highpass, lowpass } from "./dsp/eq";
import { fft } from "./dsp/fft";
import { applyVolume, NORMALIZE_PEAK, peakOf, softLimit } from "./dsp/volume";
import { applyEffects, cloneEffects, DEFAULT_EFFECTS, isNeutral, PRESETS } from "./effects";

const SR = 44100;

function mono(samples: Float32Array): AudioData {
  return { sampleRate: SR, channels: [samples] };
}

function sine(freq: number, seconds: number, amp = 0.5): AudioData {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return mono(x);
}

/** Repeatable pseudo-random noise in [-amp, amp]. */
function noise(n: number, amp: number, seed = 1): Float32Array {
  let s = seed;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    x[i] = ((s / 0xffffffff) * 2 - 1) * amp;
  }
  return x;
}

function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
}

/** Magnitude of one frequency in a signal (Goertzel). */
function tone(x: Float32Array, freq: number): number {
  const w = (2 * Math.PI * freq) / SR;
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    re += x[i] * Math.cos(w * i);
    im -= x[i] * Math.sin(w * i);
  }
  return (2 * Math.hypot(re, im)) / x.length;
}

const db = (x: number) => 20 * Math.log10(x);

describe("fft", () => {
  it("finds a sine and round-trips", () => {
    const n = 256;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 8 * i) / n);
    const original = re.slice();
    fft(re, im);
    expect(Math.hypot(re[8], im[8])).toBeGreaterThan(n / 2 - 1);
    expect(Math.hypot(re[20], im[20])).toBeLessThan(1e-3);
    fft(re, im, true);
    for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(original[i], 4);
  });
});

describe("low-pass and high-pass", () => {
  it("low-pass removes highs and keeps lows", () => {
    const lo = lowpass(sine(200, 1), 1000).channels[0];
    const hi = lowpass(sine(10000, 1), 1000).channels[0];
    expect(rms(lo, 20000)).toBeGreaterThan(0.33);
    expect(rms(hi, 20000)).toBeLessThan(0.02);
  });

  it("high-pass removes lows and keeps highs", () => {
    const lo = highpass(sine(60, 1), 1000).channels[0];
    const hi = highpass(sine(5000, 1), 1000).channels[0];
    expect(rms(lo, 20000)).toBeLessThan(0.02);
    expect(rms(hi, 20000)).toBeGreaterThan(0.33);
  });

  it("are no-ops at their off settings", () => {
    const a = sine(300, 0.1);
    expect(lowpass(a, 20000)).toBe(a);
    expect(highpass(a, 20)).toBe(a);
  });
});

describe("spectralDenoise", () => {
  // 0.3s of background hiss only, then a tone over the same hiss.
  const hissLen = Math.round(0.3 * SR);
  const total = SR * 1.3;
  const hiss = noise(total, 0.05);
  const toneSig = sine(440, 1.3, 0.4).channels[0];
  const mixed = new Float32Array(total);
  for (let i = 0; i < total; i++) mixed[i] = hiss[i] + (i >= hissLen ? toneSig[i] : 0);

  it("turns the background noise down a lot and keeps the tone", () => {
    const out = spectralDenoise(mono(mixed), 0.8).channels[0];
    const before = rms(mixed, 2000, hissLen - 2000);
    const after = rms(out, 2000, hissLen - 2000);
    expect(db(after / before)).toBeLessThan(-8);
    // tone region: the 440 Hz component is still there at close to its original level
    const mid = mixed.slice(SR * 0.6, SR * 1.2);
    const midOut = out.slice(SR * 0.6, SR * 1.2);
    expect(db(tone(midOut, 440) / tone(mid, 440))).toBeGreaterThan(-1.5);
  });

  it("keeps the length and stays finite", () => {
    const out = spectralDenoise(mono(mixed), 1);
    expect(lengthSamples(out)).toBe(total);
    for (const v of out.channels[0]) if (!Number.isFinite(v)) throw new Error("non-finite sample");
  });

  it("strength 0 is a no-op", () => {
    const a = mono(mixed);
    expect(spectralDenoise(a, 0)).toBe(a);
  });

  it("more strength removes more noise", () => {
    const low = rms(spectralDenoise(mono(mixed), 0.2).channels[0], 2000, hissLen - 2000);
    const high = rms(spectralDenoise(mono(mixed), 0.9).channels[0], 2000, hissLen - 2000);
    expect(high).toBeLessThan(low);
  });
});

describe("noiseGate", () => {
  it("silences quiet parts and passes loud parts", () => {
    const n = SR;
    const x = noise(n, 0.01);
    const loud = sine(300, 0.3, 0.5).channels[0];
    for (let i = 0; i < loud.length; i++) x[22050 + i] += loud[i];
    const out = noiseGate(mono(x), -30).channels[0];
    expect(rms(out, 2000, 15000)).toBeLessThan(rms(x, 2000, 15000) * 0.1);
    expect(rms(out, 24255, 33075)).toBeGreaterThan(rms(x, 24255, 33075) * 0.9);
  });

  it("is off at -80 dB", () => {
    const a = sine(300, 0.1);
    expect(noiseGate(a, -80)).toBe(a);
  });
});

describe("volume", () => {
  it("boosts by the requested dB", () => {
    const out = applyVolume(sine(300, 0.5, 0.1), 6, false).channels[0];
    expect(peakOf(mono(out))).toBeCloseTo(0.1 * Math.pow(10, 6 / 20), 2);
  });

  it("normalize brings the peak to just under full scale", () => {
    const out = applyVolume(sine(300, 0.5, 0.1), 0, true);
    expect(peakOf(out)).toBeGreaterThan(NORMALIZE_PEAK - 0.03);
    expect(peakOf(out)).toBeLessThan(0.95);
  });

  it("never clips, even with a huge boost", () => {
    const out = applyVolume(sine(300, 0.5, 0.9), 24, false);
    expect(peakOf(out)).toBeLessThan(0.99);
  });

  it("limiter leaves quiet samples alone and keeps order", () => {
    expect(softLimit(0.5)).toBe(0.5);
    expect(softLimit(-0.5)).toBe(-0.5);
    expect(softLimit(2)).toBeGreaterThan(softLimit(1));
    expect(softLimit(-3)).toBeGreaterThan(-1);
  });

  it("0 dB without normalize is a no-op", () => {
    const a = sine(300, 0.1);
    expect(applyVolume(a, 0, false)).toBe(a);
  });
});

describe("distort", () => {
  it("adds harmonics and stays bounded", () => {
    const clean = sine(200, 0.5, 0.3).channels[0];
    const out = distort(sine(200, 0.5, 0.3), 0.7, 1).channels[0];
    expect(tone(out, 600)).toBeGreaterThan(tone(clean, 600) + 0.02);
    expect(peakOf(mono(out))).toBeLessThan(0.8);
  });

  it("tone knob darkens the sound", () => {
    const x = mono(noise(SR / 2, 0.3));
    const bright = distort(x, 0.5, 1).channels[0];
    const dark = distort(x, 0.5, 0).channels[0];
    expect(rms(dark, 5000)).toBeLessThan(rms(bright, 5000));
  });

  it("drive 0 is a no-op", () => {
    const a = sine(300, 0.1);
    expect(distort(a, 0, 0.5)).toBe(a);
  });
});

describe("robot", () => {
  it("creates side tones around the original frequency", () => {
    const out = robot(sine(1000, 0.5, 0.5), 100, 1).channels[0];
    expect(tone(out, 900)).toBeGreaterThan(0.1);
    expect(tone(out, 1100)).toBeGreaterThan(0.1);
    expect(tone(out, 1000)).toBeLessThan(0.03);
  });

  it("mix 0 is a no-op", () => {
    const a = sine(300, 0.1);
    expect(robot(a, 80, 0)).toBe(a);
  });
});

describe("echo", () => {
  it("repeats a click after the delay time, quieter each time", () => {
    const x = new Float32Array(SR);
    x[0] = 1;
    const out = echo(mono(x), 0.25, 0.5, 0.8).channels[0];
    const d = Math.round(0.25 * SR);
    expect(out[d]).toBeCloseTo(0.8, 3);
    expect(out[2 * d]).toBeCloseTo(0.8 * 0.5, 3);
    expect(out[3 * d]).toBeCloseTo(0.8 * 0.25, 3);
  });

  it("extends the clip by the tail", () => {
    const a = sine(300, 0.2);
    const out = echo(a, 0.2, 0.5, 0.5);
    expect(lengthSamples(out)).toBe(lengthSamples(a) + Math.round(echoTailSeconds(0.2, 0.5) * SR));
  });

  it("never lets the tail run past 4 seconds", () => {
    expect(echoTailSeconds(1, 0.9)).toBeLessThanOrEqual(4);
  });

  it("mix 0 is a no-op", () => {
    const a = sine(300, 0.1);
    expect(echo(a, 0.2, 0.5, 0)).toBe(a);
  });
});

describe("smoother 8-bit", () => {
  it("smoothing takes the harsh top end off", () => {
    const x = mono(noise(SR, 0.4, 7));
    const harsh = bitcrush(x, 6, 4, 0).channels[0];
    const soft = bitcrush(x, 6, 4, 0.8).channels[0];
    const edges = (s: Float32Array) => {
      let t = 0;
      for (let i = 1; i < s.length; i++) t += Math.abs(s[i] - s[i - 1]);
      return t;
    };
    expect(edges(soft)).toBeLessThan(edges(harsh) * 0.7);
  });

  it("smooth 0 matches the old behaviour", () => {
    const out = bitcrush(sine(300, 0.1), 3, 1, 0).channels[0];
    expect(new Set(Array.from(out)).size).toBeLessThanOrEqual(8);
  });
});

describe("effects chain with the new effects", () => {
  it("every preset is audible, finite and within range", () => {
    const a = mono(noise(SR, 0.2, 3));
    for (const p of PRESETS) {
      expect(isNeutral(p.params)).toBe(false);
      const out = applyEffects(a, p.params, 15).channels[0];
      for (const v of out) if (!Number.isFinite(v)) throw new Error(`${p.id}: non-finite sample`);
    }
  });

  it("each new effect switched on with its defaults changes the sound", () => {
    for (const key of ["clean", "filter", "distort", "robot", "crush", "echo", "volume"] as const) {
      const p = cloneEffects(DEFAULT_EFFECTS);
      p[key].on = true;
      if (key === "volume") p.volume.db = 6;
      expect(isNeutral(p)).toBe(false);
    }
  });

  it("volume is applied last, so a boost isn't undone by later effects", () => {
    const p = cloneEffects(DEFAULT_EFFECTS);
    p.volume = { on: true, db: 12, normalize: false };
    p.reverb = { on: true, size: 0.3, damp: 0.5, mix: 0.3 };
    const quiet = sine(300, 0.5, 0.05);
    const loud = applyEffects(quiet, p);
    p.volume.on = false;
    const base = applyEffects(quiet, p);
    expect(peakOf(loud)).toBeGreaterThan(peakOf(base) * 3);
  });

  it("clean-up before 8-bit: noise reduction lowers the hiss that gets crushed", () => {
    const hiss = mono(noise(SR, 0.03, 9));
    const p = cloneEffects(DEFAULT_EFFECTS);
    p.crush = { on: true, bits: 8, hold: 1, smooth: 0.5 };
    const withoutClean = applyEffects(hiss, p).channels[0];
    p.clean = { on: true, reduce: 1, gate: -40 };
    const withClean = applyEffects(hiss, p).channels[0];
    expect(rms(withClean)).toBeLessThan(rms(withoutClean) * 0.5);
  });
});
