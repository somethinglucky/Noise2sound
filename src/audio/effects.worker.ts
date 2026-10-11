/// <reference lib="webworker" />
import type { AudioData } from "./data";
import { runEffects, type EffectsParams } from "./effects";

export type WorkerRequest =
  | { type: "load"; data: AudioData }
  | { type: "run"; id: number; params: EffectsParams; maxSeconds: number };

export interface WorkerResponse {
  id: number;
  data: AudioData;
  truncated: boolean;
}

let source: AudioData | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "load") {
    source = msg.data;
    return;
  }
  if (!source) return;
  const { data, truncated } = runEffects(source, msg.params, msg.maxSeconds);
  // If nothing changed, `data` is the source itself; send a copy so we keep ours.
  const out: AudioData =
    data === source
      ? { sampleRate: data.sampleRate, channels: data.channels.map((c) => c.slice()) }
      : data;
  const response: WorkerResponse = { id: msg.id, data: out, truncated };
  (self as unknown as Worker).postMessage(
    response,
    out.channels.map((c) => c.buffer),
  );
};
