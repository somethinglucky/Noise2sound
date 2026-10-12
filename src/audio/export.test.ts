import { describe, expect, it } from "vitest";
import { convertSampleRate, softEdges, toMono, trimSilence } from "./convert";
import { type AudioData, lengthSamples } from "./data";
import {
  DEFAULT_EXPORT,
  encodeAudio,
  estimateBytes,
  exportAudio,
  formatBytes,
  prepareAudio,
  safeFileName,
} from "./exporter";
import { encodeWav } from "./wav";

function sine(freq: number, seconds: number, sr = 44100, amp = 0.5, channels = 1): AudioData {
  const n = Math.round(seconds * sr);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return { sampleRate: sr, channels: Array.from({ length: channels }, () => ch.slice()) };
}

function freqOf(x: Float32Array, sr: number): number {
  let crossings = 0;
  const from = Math.floor(x.length * 0.2);
  const to = Math.floor(x.length * 0.8);
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++;
  return crossings / ((to - from) / sr);
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.slice(at, at + n));

describe("convert helpers", () => {
  it("mixes stereo down to the average", () => {
    const a: AudioData = { sampleRate: 100, channels: [Float32Array.from([1, 0, 0.5]), Float32Array.from([0, 1, 0.5])] };
    expect(Array.from(toMono(a).channels[0])).toEqual([0.5, 0.5, 0.5]);
  });

  it("mono stays the same object", () => {
    const a = sine(300, 0.1);
    expect(toMono(a)).toBe(a);
  });

  it("changes the sample rate but keeps the sound and the duration", () => {
    const out = convertSampleRate(sine(440, 1, 44100), 22050);
    expect(out.sampleRate).toBe(22050);
    expect(Math.abs(lengthSamples(out) - 22050)).toBeLessThanOrEqual(1);
    expect(freqOf(out.channels[0], 22050)).toBeGreaterThan(425);
    expect(freqOf(out.channels[0], 22050)).toBeLessThan(455);
  });

  it("same rate is a no-op", () => {
    const a = sine(300, 0.1);
    expect(convertSampleRate(a, 44100)).toBe(a);
  });

  it("trims silence from both ends and keeps a little margin", () => {
    const sr = 1000;
    const x = new Float32Array(1000);
    for (let i = 300; i < 600; i++) x[i] = 0.5;
    const out = trimSilence({ sampleRate: sr, channels: [x] }, -60, 10);
    expect(lengthSamples(out)).toBe(300 + 20); // 10 ms (10 samples) kept each side
  });

  it("leaves all-silent clips alone", () => {
    const a: AudioData = { sampleRate: 1000, channels: [new Float32Array(500)] };
    expect(trimSilence(a)).toBe(a);
  });

  it("soft edges start and end at zero and leave the middle alone", () => {
    const a: AudioData = { sampleRate: 1000, channels: [new Float32Array(200).fill(1)] };
    const out = softEdges(a, 20).channels[0];
    expect(out[0]).toBe(0);
    expect(out[199]).toBe(0);
    expect(out[100]).toBe(1);
    expect(out[10]).toBeGreaterThan(0.3);
    expect(out[10]).toBeLessThan(0.7);
  });
});

describe("WAV", () => {
  it("writes 24-bit files with the right header and size", async () => {
    const a: AudioData = { sampleRate: 8000, channels: [Float32Array.from([0, 0.5, -0.5, 1])] };
    const blob = encodeWav(a, 24);
    const b = await bytesOf(blob);
    const view = new DataView(b.buffer);
    expect(blob.size).toBe(44 + 4 * 3);
    expect(view.getUint16(34, true)).toBe(24);
    expect(view.getUint32(40, true)).toBe(12);
    // second sample = +0.5 -> 0x400000 (little endian 3 bytes)
    expect([b[47], b[48], b[49]]).toEqual([0x00, 0x00, 0x40]);
    // last sample = +1.0 -> 0x7FFFFF
    expect([b[53], b[54], b[55]]).toEqual([0xff, 0xff, 0x7f]);
  });

  it("estimate matches the real WAV size", async () => {
    const a = sine(300, 0.5, 44100, 0.5, 2);
    for (const bits of [16, 24] as const) {
      const o = { ...DEFAULT_EXPORT, format: "wav" as const, wavBits: bits };
      const blob = await encodeAudio(a, o);
      expect(estimateBytes(a, o)).toBe(blob.size);
    }
  });
});

describe("MP3 and OGG encoders", () => {
  it("encodes a valid MP3 of about the expected size", async () => {
    const a = sine(440, 2, 44100, 0.5, 2);
    const blob = await encodeAudio(a, { ...DEFAULT_EXPORT, format: "mp3", mp3Kbps: 128 });
    const b = await bytesOf(blob);
    expect(blob.type).toBe("audio/mpeg");
    const hasId3 = ascii(b, 0, 3) === "ID3";
    const hasSync = b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
    expect(hasId3 || hasSync).toBe(true);
    // 128 kbps for 2 s = 32,000 bytes
    expect(blob.size).toBeGreaterThan(26000);
    expect(blob.size).toBeLessThan(40000);
  });

  it("higher MP3 bitrate makes a bigger file", async () => {
    const a = sine(440, 1, 44100, 0.5, 1);
    const small = await encodeAudio(a, { ...DEFAULT_EXPORT, format: "mp3", mp3Kbps: 96 });
    const big = await encodeAudio(a, { ...DEFAULT_EXPORT, format: "mp3", mp3Kbps: 320 });
    expect(big.size).toBeGreaterThan(small.size * 2);
  });

  it("encodes a valid Ogg Vorbis file", async () => {
    const a = sine(440, 1, 44100, 0.5, 2);
    const blob = await encodeAudio(a, { ...DEFAULT_EXPORT, format: "ogg", oggQuality: 5 });
    const b = await bytesOf(blob);
    expect(blob.type).toBe("audio/ogg");
    expect(ascii(b, 0, 4)).toBe("OggS");
    expect(ascii(b, 29, 6)).toBe("vorbis"); // identification header in the first page
    expect(blob.size).toBeGreaterThan(3000);
  });

  it("handles mono and a low sample rate", async () => {
    const a = sine(440, 1, 22050, 0.5, 1);
    const mp3 = await encodeAudio(a, { ...DEFAULT_EXPORT, format: "mp3", mp3Kbps: 96 });
    const ogg = await encodeAudio(a, { ...DEFAULT_EXPORT, format: "ogg", oggQuality: 2 });
    expect(mp3.size).toBeGreaterThan(1000);
    expect(ascii(await bytesOf(ogg), 0, 4)).toBe("OggS");
  });

  it("exportAudio applies the clean-up options before encoding", async () => {
    const a = sine(440, 1, 44100, 0.5, 2);
    const blob = await exportAudio(a, { ...DEFAULT_EXPORT, format: "wav", mono: true, sampleRate: 22050 });
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(22050);
  });
});

describe("export helpers", () => {
  it("prepares audio in a sensible order", () => {
    const x = new Float32Array(44100);
    for (let i = 10000; i < 20000; i++) x[i] = 0.4;
    const a: AudioData = { sampleRate: 44100, channels: [x, x.slice()] };
    const out = prepareAudio(a, { ...DEFAULT_EXPORT, trimSilence: true, mono: true, sampleRate: 22050 });
    expect(out.channels.length).toBe(1);
    expect(out.sampleRate).toBe(22050);
    expect(lengthSamples(out)).toBeLessThan(6000);
  });

  it("builds safe file names", () => {
    expect(safeFileName("My Cool Sound!", "wav")).toBe("My_Cool_Sound.wav");
    expect(safeFileName("take1.m4a", "mp3")).toBe("take1.mp3");
    expect(safeFileName("../../etc/passwd", "ogg")).toBe("etcpasswd.ogg");
    expect(safeFileName(".hidden", "wav")).toBe("hidden.wav");
    expect(safeFileName("   ", "wav")).toBe("noise2sound.wav");
    expect(safeFileName("sound/effect", "wav")).toBe("soundeffect.wav");
  });

  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
