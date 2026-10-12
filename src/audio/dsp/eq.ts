import type { AudioData } from "../data";

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

type Kind = "lowshelf" | "peaking" | "highshelf" | "lowpass" | "highpass";

/** Filter coefficients from the RBJ Audio EQ Cookbook, normalised so a0 = 1. */
function design(kind: Kind, sampleRate: number, freq: number, gainDb: number, q: number): Biquad {
  const f = Math.min(freq, sampleRate * 0.45);
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (kind === "lowpass" || kind === "highpass") {
    if (kind === "lowpass") {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
    } else {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
    }
    b2 = b0;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (kind === "peaking") {
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else {
    const sq = 2 * Math.sqrt(A) * alpha;
    if (kind === "lowshelf") {
      b0 = A * (A + 1 - (A - 1) * cos + sq);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - sq);
      a0 = A + 1 + (A - 1) * cos + sq;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - sq;
    } else {
      b0 = A * (A + 1 + (A - 1) * cos + sq);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - sq);
      a0 = A + 1 - (A - 1) * cos + sq;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - sq;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function run(input: Float32Array, c: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

export const EQ_LOW_HZ = 200;
export const EQ_MID_HZ = 1000;
export const EQ_HIGH_HZ = 4000;

/** Three-band EQ: low shelf, mid bell, high shelf. Gains are in dB. */
export function eq3(a: AudioData, lowDb: number, midDb: number, highDb: number): AudioData {
  const sr = a.sampleRate;
  const stages: Biquad[] = [];
  if (Math.abs(lowDb) > 0.01) stages.push(design("lowshelf", sr, EQ_LOW_HZ, lowDb, 0.707));
  if (Math.abs(midDb) > 0.01) stages.push(design("peaking", sr, EQ_MID_HZ, midDb, 0.9));
  if (Math.abs(highDb) > 0.01) stages.push(design("highshelf", sr, EQ_HIGH_HZ, highDb, 0.707));
  if (stages.length === 0) return a;

  return {
    sampleRate: sr,
    channels: a.channels.map((ch) => stages.reduce((signal, stage) => run(signal, stage), ch)),
  };
}

function passFilter(a: AudioData, kind: "lowpass" | "highpass", hz: number): AudioData {
  const stage = design(kind, a.sampleRate, hz, 0, 0.707);
  return { sampleRate: a.sampleRate, channels: a.channels.map((ch) => run(ch, stage)) };
}

/** Removes everything above `hz` (muffled, "behind a wall"). Off at or above 19 kHz. */
export function lowpass(a: AudioData, hz: number): AudioData {
  return hz >= 19000 ? a : passFilter(a, "lowpass", Math.max(hz, 50));
}

/** Removes everything below `hz` (thin sound, rumble removal). Off at or below 25 Hz. */
export function highpass(a: AudioData, hz: number): AudioData {
  return hz <= 25 ? a : passFilter(a, "highpass", hz);
}
