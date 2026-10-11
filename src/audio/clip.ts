export interface Clip {
  /** Display name, e.g. the uploaded file name or "Recording". */
  name: string;
  blob: Blob;
  /** Object URL for playback. Revoke with URL.revokeObjectURL when discarded. */
  url: string;
  durationSeconds: number;
}

/** Decode a blob just to learn its duration. Throws if the browser can't decode it. */
export async function getDurationSeconds(blob: Blob): Promise<number> {
  const Ctx: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const data = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    return buffer.duration;
  } finally {
    void ctx.close();
  }
}

export async function makeClip(name: string, blob: Blob): Promise<Clip> {
  const durationSeconds = await getDurationSeconds(blob);
  return { name, blob, url: URL.createObjectURL(blob), durationSeconds };
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${rest}`;
}
