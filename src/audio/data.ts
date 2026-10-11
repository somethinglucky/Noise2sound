/** Raw audio held in memory: one Float32Array of samples per channel. */
export interface AudioData {
  sampleRate: number;
  channels: Float32Array[];
}

export function lengthSamples(a: AudioData): number {
  return a.channels[0]?.length ?? 0;
}

export function durationSeconds(a: AudioData): number {
  return a.sampleRate > 0 ? lengthSamples(a) / a.sampleRate : 0;
}

/** Decode any audio file/blob the browser understands into raw samples. */
export async function decodeBlob(blob: Blob): Promise<AudioData> {
  const Ctx: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channels.push(new Float32Array(buffer.getChannelData(c)));
    }
    return { sampleRate: buffer.sampleRate, channels };
  } finally {
    void ctx.close();
  }
}
