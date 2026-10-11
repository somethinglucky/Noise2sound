import { type AudioData, decodeBlob, durationSeconds } from "./data";

export interface Clip {
  /** Display name, e.g. the uploaded file name or "Recording". */
  name: string;
  data: AudioData;
  durationSeconds: number;
}

/** Decode a recording or uploaded file into a clip. Throws if the browser can't decode it. */
export async function makeClip(name: string, blob: Blob): Promise<Clip> {
  const data = await decodeBlob(blob);
  return { name, data, durationSeconds: durationSeconds(data) };
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${rest}`;
}
