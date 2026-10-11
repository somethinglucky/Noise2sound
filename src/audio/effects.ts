import { type AudioData, lengthSamples } from "./data";
import { bitcrush } from "./dsp/bitcrush";
import { eq3 } from "./dsp/eq";
import { pitchShift, resample } from "./dsp/pitch";
import { reverb } from "./dsp/reverb";

/** Every effect has an on/off switch and its own settings. */
export interface EffectsParams {
  pitch: { on: boolean; semitones: number };
  speed: { on: boolean; factor: number };
  eq: { on: boolean; low: number; mid: number; high: number };
  crush: { on: boolean; bits: number; hold: number };
  reverb: { on: boolean; size: number; damp: number; mix: number };
}

export const DEFAULT_EFFECTS: EffectsParams = {
  pitch: { on: false, semitones: 0 },
  speed: { on: false, factor: 1 },
  eq: { on: false, low: 0, mid: 0, high: 0 },
  crush: { on: false, bits: 8, hold: 1 },
  reverb: { on: false, size: 0.5, damp: 0.5, mix: 0.3 },
};

export function cloneEffects(p: EffectsParams): EffectsParams {
  return {
    pitch: { ...p.pitch },
    speed: { ...p.speed },
    eq: { ...p.eq },
    crush: { ...p.crush },
    reverb: { ...p.reverb },
  };
}

/** True when applying these settings would leave the audio unchanged. */
export function isNeutral(p: EffectsParams): boolean {
  return (
    !(p.pitch.on && Math.abs(p.pitch.semitones) >= 0.005) &&
    !(p.speed.on && Math.abs(p.speed.factor - 1) >= 0.001) &&
    !(p.eq.on && (Math.abs(p.eq.low) > 0.01 || Math.abs(p.eq.mid) > 0.01 || Math.abs(p.eq.high) > 0.01)) &&
    !(p.crush.on && (p.crush.bits < 16 || p.crush.hold > 1)) &&
    !(p.reverb.on && p.reverb.mix >= 0.005)
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
  preset("monster", "Monster", {
    pitch: { on: true, semitones: -7 },
    eq: { on: true, low: 6, mid: 0, high: -5 },
    reverb: { on: true, size: 0.35, damp: 0.6, mix: 0.2 },
  }),
  preset("chipmunk", "Chipmunk", {
    pitch: { on: true, semitones: 9 },
    eq: { on: true, low: -4, mid: 2, high: 3 },
  }),
  preset("retro", "Retro 8-bit", {
    crush: { on: true, bits: 5, hold: 4 },
    eq: { on: true, low: -3, mid: 4, high: 0 },
  }),
  preset("radio", "Old radio", {
    eq: { on: true, low: -12, mid: 8, high: -8 },
    crush: { on: true, bits: 9, hold: 2 },
  }),
  preset("cave", "Cave", {
    reverb: { on: true, size: 0.85, damp: 0.35, mix: 0.5 },
  }),
];

/** Same as applyEffects, but also reports whether the result had to be cut at `maxSeconds`. */
export function runEffects(
  input: AudioData,
  p: EffectsParams,
  maxSeconds = Infinity,
): { data: AudioData; truncated: boolean } {
  let a = input;

  // Speed changes the length but keeps the pitch; Pitch changes the pitch but keeps the length.
  const ratio = p.speed.on ? Math.min(Math.max(p.speed.factor, 0.25), 4) : 1;
  const semis = p.pitch.on ? p.pitch.semitones : 0;
  if (ratio !== 1 || Math.abs(semis) >= 0.005) {
    const resampled = resample(a, ratio);
    // Resampling moved the pitch by log2(ratio) octaves, so shift it back (plus the requested shift).
    a = pitchShift(resampled, semis - 12 * Math.log2(ratio));
  }

  if (p.eq.on) a = eq3(a, p.eq.low, p.eq.mid, p.eq.high);
  if (p.crush.on) a = bitcrush(a, p.crush.bits, p.crush.hold);
  if (p.reverb.on) a = reverb(a, p.reverb.size, p.reverb.damp, p.reverb.mix);

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
 * Run the whole chain: speed and pitch, then EQ, then 8-bit, then reverb.
 * The result is cut off at `maxSeconds` if it would run longer.
 */
export function applyEffects(input: AudioData, p: EffectsParams, maxSeconds = Infinity): AudioData {
  return runEffects(input, p, maxSeconds).data;
}
