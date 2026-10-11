import { useEffect, useRef, useState } from "react";
import type { AudioData } from "./data";
import { isNeutral, runEffects, type EffectsParams } from "./effects";
import type { WorkerRequest, WorkerResponse } from "./effects.worker";

export interface Preview {
  /** The processed audio for the current settings, or null if nothing to process or not ready yet. */
  result: AudioData | null;
  /** True if the result was cut at the free-tier length limit. */
  truncated: boolean;
  /** True while a new result is being computed. */
  processing: boolean;
}

const DEBOUNCE_MS = 150;

/**
 * Renders `source` through the effects chain in a background worker whenever the
 * settings change, so sliders stay responsive. If workers aren't available the
 * work runs on the main thread instead.
 */
export function useEffectsPreview(
  source: AudioData,
  params: EffectsParams,
  enabled: boolean,
  maxSeconds: number,
): Preview {
  const active = enabled && !isNeutral(params);
  const [preview, setPreview] = useState<Preview>({ result: null, truncated: false, processing: false });

  const workerRef = useRef<Worker | null>(null);
  const failedRef = useRef(false);
  const latestIdRef = useRef(0);
  const sentSourceRef = useRef<AudioData | null>(null);

  // Start the worker once.
  useEffect(() => {
    try {
      const worker = new Worker(new URL("./effects.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.id !== latestIdRef.current) return; // a newer request is on its way
        setPreview({ result: e.data.data, truncated: e.data.truncated, processing: false });
      };
      worker.onerror = () => {
        failedRef.current = true;
        worker.terminate();
        workerRef.current = null;
      };
      workerRef.current = worker;
    } catch {
      failedRef.current = true;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      sentSourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      latestIdRef.current++; // drop anything still in flight
      setPreview((p) => (p.result || p.processing ? { result: null, truncated: false, processing: false } : p));
      return;
    }

    setPreview((p) => ({ ...p, processing: true }));
    const id = ++latestIdRef.current;

    const timer = window.setTimeout(() => {
      const worker = workerRef.current;
      if (worker && !failedRef.current) {
        if (sentSourceRef.current !== source) {
          const copy: AudioData = {
            sampleRate: source.sampleRate,
            channels: source.channels.map((c) => c.slice()),
          };
          const load: WorkerRequest = { type: "load", data: copy };
          worker.postMessage(load, copy.channels.map((c) => c.buffer));
          sentSourceRef.current = source;
        }
        const run: WorkerRequest = { type: "run", id, params, maxSeconds };
        worker.postMessage(run);
      } else {
        // No worker: do it here (this blocks the UI briefly).
        const { data, truncated } = runEffects(source, params, maxSeconds);
        if (id === latestIdRef.current) setPreview({ result: data, truncated, processing: false });
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [active, source, params, maxSeconds]);

  return preview;
}
