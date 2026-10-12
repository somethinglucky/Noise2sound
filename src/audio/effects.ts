import { type AudioData, lengthSamples } from "./data";
import { bitcrush } from "./dsp/bitcrush";
import { distort, echo, robot } from "./dsp/character";
import { noiseGate, spectralDenoise } from "./dsp/denoise";
import { eq3, highpass, lowpass } from "./dsp/eq";
import { pitchShift, resample } from "./dsp/pitch";
import { reverb } from "./dsp/reverb";
import { applyVolume } from "./dsp/volume";

/** Every effect has an on/off switch and its own settings. */
export interface EffectsParams {
  /** Noise reduction (0..1) and noise gate threshold in dB (-80 = off). */
  clean: { on: boolean; reduce: number; gate: number };
  pitch: { on: boolean; semitones: number };
  speed: { on: boolean; factor: number };
  /** Low-pass ("muffle") and high-pass ("thin") cutoffs in Hz. 20000 / 20 = off. */
  filter: { on: boolean; low: number; high: number };
  eq: { on: boolean; low: number; mid: number; high: number };
  distort: { on: boolean; drive: number; tone: number };
  robot: { on: boolean; freq: number; mix: number };
  crush: { on: boolean; bits: number; hold: number; smooth: number };
  echo: { on: boolean; time: number; feedback: number; mix: number };
  reverb: { on: boolean; size: number; damp: number; mix: number };
  volume: { on: boolean; db: number; normalize: boolean };
}

export const DEFAULT_EFFECTS: EffectsParams = {
  clean: { on: false, reduce: 0.6, gate: -80 },
  pitch: { on: false, semitones: 0 },
  speed: { on: false, factor: 1 },
  filter: { on: false, low: 6000, high: 80 },
  eq: { on: false, low: 0, mid: 0, high: 0 },
  distort: { on: false, drive: 0.4, tone: 0.7 },
  robot: { on: false, freq: 60, mix: 1 },
  crush: { on: false, bits: 8, hold: 1, smooth: 0.5 },
  echo: { on: false, time: 0.25, feedback: 0.4, mix: 0.5 },
  reverb: { on: false, size: 0.5, damp: 0.5, mix: 0.3 },
  volume: { on: false, db: 6, normalize: false },
};

export function cloneEffects(p: EffectsParams): EffectsParams {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(p)) out[key] = { ...(value as object) };
  return out as unknown as EffectsParams;
}

/** True when applying these settings would leave the audio unchanged. */
export function isNeutral(p: EffectsParams): boolean {
  const near = (v: number, target: number, eps = 0.01) => Math.abs(v - target) < eps;
  return (
    !(p.clean.on && (p.clean.reduce >= 0.01 || p.clean.gate > -79)) &&
    !(p.pitch.on && !near(p.pitch.semitones, 0, 0.005)) &&
    !(p.speed.on && !near(p.speed.factor, 1, 0.001)) &&
    !(p.filter.on && (p.filter.low < 19000 || p.filter.high > 25)) &&
    !(p.eq.on && !(near(p.eq.low, 0) && near(p.eq.mid, 0) && near(p.eq.high, 0))) &&
    !(p.distort.on && p.distort.drive >= 0.01) &&
    !(p.robot.on && p.robot.mix >= 0.01) &&
    !(p.crush.on && (p.crush.bits < 16 || p.crush.hold > 1)) &&
    !(p.echo.on && p.echo.mix >= 0.01) &&
    !(p.reverb.on && p.reverb.mix >= 0.005) &&
    !(p.volume.on && (p.volume.normalize || !near(p.volume.db, 0, 0.01)))
  );
}

export interface Preset {
  id: string;
  label: string;
  params: EffectsParams;
}

function preset(id: string, label: string, patch: Partial<EffectsParams>): Preset {
  return { id, label, params: { ...cloneEffects(DEFAULT_EFFECTS), ...patch } };
}

export const PRESETS: Preset[] = [
  preset("clean", "Clean up", {
    clean: { on: true, reduce: 0.7, gate: -80 },
    filter: { on: true, low: 20000, high: 90 },
    volume: { on: true, db: 0, normalize: true },
  }),
  preset("louder", "Louder", {
    volume: { on: true, db: 6, normalize: true },
  }),
  preset("monster", "Monster", {
    pitch: { on: true, semitones: -7 },
    eq: { on: true, low: 6, mid: 0, high: -5 },
    distort: { on: true, drive: 0.25, tone: 0.4 },
    reverb: { on: true, size: 0.35, damp: 0.6, mix: 0.2 },
  }),
  preset("chipmunk", "Chipmunk", {
    pitch: { on: true, semitones: 9 },
    eq: { on: true, low: -4, mid: 2, high: 3 },
  }),
  preset("retro", "Retro 8-bit", {
    crush: { on: true, bits: 6, hold: 3, smooth: 0.6 },
    eq: { on: true, low: -3, mid: 4, high: 0 },
  }),
  preset("robot", "Robot", {
    robot: { on: true, freq: 70, mix: 1 },
    echo: { on: true, time: 0.08, feedback: 0.3, mix: 0.3 },
  }),
  preset("alien", "Alien", {
    pitch: { on: true, semitones: 4 },
    robot: { on: true, freq: 30, mix: 0.6 },
    reverb: { on: true, size: 0.5, damp: 0.4, mix: 0.3 },
  }),
  preset("radio", "Old radio", {
    filter: { on: true, low: 3400, high: 350 },
    distort: { on: true, drive: 0.15, tone: 0.6 },
    crush: { on: true, bits: 10, hold: 2, smooth: 0.6 },
  }),
  preset("muffled", "Muffled", {
    filter: { on: true, low: 700, high: 20 },
    reverb: { on: true, size: 0.3, damp: 0.7, mix: 0.2 },
  }),
  preset("cave", "Cave", {
    reverb: { on: true, size: 0.85, damp: 0.35, mix: 0.5 },
    echo: { on: true, time: 0.35, feedback: 0.35, mix: 0.3 },
  }),
];

/** Same as applyEffects, but also reports whether the result had to be cut at `maxSeconds`. */
export function runEffects(
  input: AudioData,
  p: EffectsParams,
  maxSeconds = Infinity,
): { data: AudioData; truncated: boolean } {
  let a = input;

  // 1. Clean up first, while the recording is untouched.
  if (p.clean.on) {
    a = spectralDenoise(a, p.clean.reduce);
    a = noiseGate(a, p.clean.gate);
  }

  // 2. Speed changes the length but keeps the pitch; Pitch changes the pitch but keeps the length.
  const ratio = p.speed.on ? Math.min(Math.max(p.speed.factor, 0.25), 4) : 1;
  const semis = p.pitch.on ? p.pitch.semitones : 0;
  if (ratio !== 1 || Math.abs(semis) >= 0.005) {
    const resampled = resample(a, ratio);
    // Resampling moved the pitch by log2(ratio) octaves, so shift it back (plus the requested shift).
    a = pitchShift(resampled, semis - 12 * Math.log2(ratio));
  }

  // 3. Tone shaping, then character.
  if (p.filter.on) a = lowpass(highpass(a, p.filter.high), p.filter.low);
  if (p.eq.on) a = eq3(a, p.eq.low, p.eq.mid, p.eq.high);
  if (p.distort.on) a = distort(a, p.distort.drive, p.distort.tone);
  if (p.robot.on) a = robot(a, p.robot.freq, p.robot.mix);
  if (p.crush.on) a = bitcrush(a, p.crush.bits, p.crush.hold, p.crush.smooth);

  // 4. Space.
  if (p.echo.on) a = echo(a, p.echo.time, p.echo.feedback, p.echo.mix);
  if (p.reverb.on) a = reverb(a, p.reverb.size, p.reverb.damp, p.reverb.mix);

  // 5. Final level.
  if (p.volume.on) a = applyVolume(a, p.volume.db, p.volume.normalize);

  const maxSamples = Math.floor(maxSeconds * a.sampleRate);
  if (lengthSamples(a) > maxSamples) {
    return {
      data: { sampleRate: a.sampleRate, channels: a.channels.map((ch) => ch.slice(0, maxSamples)) },
      truncated: true,
    };
  }
  return { data: a, truncated: false };
}

/**
 * Run the whole chain: clean-up, speed and pitch, filter, EQ, distortion, robot, 8-bit,
 * echo, reverb, then volume. The result is cut off at `maxSeconds` if it would run longer.
 */
export function applyEffects(input: AudioData, p: EffectsParams, maxSeconds = Infinity): AudioData {
  return runEffects(input, p, maxSeconds).data;
}
