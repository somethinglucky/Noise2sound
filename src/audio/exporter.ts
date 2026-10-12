import { type AudioData, durationSeconds, lengthSamples } from "./data";
import { convertSampleRate, softEdges, toMono, trimSilence } from "./convert";
import { encodeWav } from "./wav";

export type ExportFormat = "wav" | "mp3" | "ogg";

export interface ExportOptions {
  format: ExportFormat;
  /** Output sample rate in Hz, or "keep" to leave it as it is. */
  sampleRate: number | "keep";
  mono: boolean;
  trimSilence: boolean;
  softEdges: boolean;
  wavBits: 16 | 24;
  mp3Kbps: 96 | 128 | 192 | 256 | 320;
  /** Ogg Vorbis quality, -1 (smallest) to 10 (best). */
  oggQuality: number;
}

export const DEFAULT_EXPORT: ExportOptions = {
  format: "wav",
  sampleRate: "keep",
  mono: false,
  trimSilence: false,
  softEdges: false,
  wavBits: 16,
  mp3Kbps: 192,
  oggQuality: 5,
};

export const FORMAT_INFO: Record<ExportFormat, { label: string; ext: string; mime: string; hint: string }> = {
  wav: { label: "WAV", ext: "wav", mime: "audio/wav", hint: "Perfect quality, biggest files. Works everywhere." },
  mp3: { label: "MP3", ext: "mp3", mime: "audio/mpeg", hint: "Small files that play almost anywhere." },
  ogg: { label: "OGG", ext: "ogg", mime: "audio/ogg", hint: "Small files, popular in game engines." },
};

/** Apply the clean-up choices (trim, soft edges, mono, sample rate) before encoding. */
export function prepareAudio(input: AudioData, o: ExportOptions): AudioData {
  let a = input;
  if (o.trimSilence) a = trimSilence(a);
  if (o.softEdges) a = softEdges(a);
  if (o.mono) a = toMono(a);
  if (o.sampleRate !== "keep") a = convertSampleRate(a, o.sampleRate);
  return a;
}

/** Rough size of the finished file in bytes. WAV is exact; MP3 and OGG are estimates. */
export function estimateBytes(a: AudioData, o: ExportOptions): number {
  const secs = durationSeconds(a);
  const channels = a.channels.length;
  if (o.format === "wav") return 44 + lengthSamples(a) * channels * (o.wavBits / 8);
  if (o.format === "mp3") return Math.round((o.mp3Kbps * 1000 * secs) / 8);
  // Vorbis quality 5 is roughly 160 kbps for stereo; it scales with quality and channel count.
  const stereoKbps = 64 + (o.oggQuality + 1) * 16;
  return Math.round((stereoKbps * 1000 * secs * (channels === 1 ? 0.55 : 1)) / 8);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Turn a clip name into a safe file name with the right extension. */
export function safeFileName(name: string, ext: string): string {
  const base =
    name
      .trim()
      .replace(/\.[a-z0-9]{2,4}$/i, "")
      .replace(/[^\p{L}\p{N}._ -]+/gu, "")
      .replace(/\s+/g, "_")
      .replace(/\.{2,}/g, ".")
      .replace(/^[._-]+/, "")
      .slice(0, 80) || "noise2sound";
  return `${base}.${ext}`;
}

const CHUNK = 1152 * 40;

type Encoder = {
  configure: (options: Record<string, unknown>) => void;
  encode: (samples: Float32Array[]) => Uint8Array;
  finalize: () => Uint8Array;
};

function runEncoder(encoder: Encoder, a: AudioData, options: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  encoder.configure({ sampleRate: a.sampleRate, channels: a.channels.length, ...options });
  const parts: Uint8Array[] = [];
  const n = lengthSamples(a);
  for (let pos = 0; pos < n; pos += CHUNK) {
    const piece = a.channels.map((ch) => ch.subarray(pos, Math.min(pos + CHUNK, n)));
    parts.push(encoder.encode(piece).slice()); // the encoder reuses its buffer, so copy
  }
  parts.push(encoder.finalize().slice());
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Encode already-prepared audio (see prepareAudio) into a file. */
export async function encodeAudio(a: AudioData, o: ExportOptions): Promise<Blob> {
  if (a.channels.length > 2) a = toMono(a); // MP3 and OGG only do 1 or 2 channels
  if (o.format === "wav") return encodeWav(a, o.wavBits);

  // The encoders are loaded only when needed, so the app starts fast.
  const lib = await import("wasm-media-encoders");
  if (o.format === "mp3") {
    const encoder = await lib.createMp3Encoder();
    const bytes = runEncoder(encoder as unknown as Encoder, a, { bitrate: o.mp3Kbps });
    return new Blob([bytes], { type: "audio/mpeg" });
  }
  const encoder = await lib.createOggEncoder();
  const bytes = runEncoder(encoder as unknown as Encoder, a, { vbrQuality: o.oggQuality });
  return new Blob([bytes], { type: "audio/ogg" });
}

/** Prepare and encode in one go. */
export async function exportAudio(input: AudioData, o: ExportOptions): Promise<Blob> {
  return encodeAudio(prepareAudio(input, o), o);
}
