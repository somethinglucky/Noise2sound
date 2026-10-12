import { useEffect, useMemo, useRef, useState } from "react";
import { type AudioData, durationSeconds } from "../audio/data";
import { formatTime } from "../audio/clip";
import { applyEffects, isNeutral, type EffectsParams } from "../audio/effects";
import {
  DEFAULT_EXPORT,
  estimateBytes,
  exportAudio,
  FORMAT_INFO,
  formatBytes,
  prepareAudio,
  safeFileName,
  type ExportFormat,
  type ExportOptions,
} from "../audio/exporter";
import { renderWaveformPng } from "../audio/waveformImage";
import { FREE_CLIP_SECONDS } from "../config";

interface Props {
  data: AudioData;
  fx: EffectsParams;
  clipName: string;
}

const RATES: { label: string; value: number | "keep" }[] = [
  { label: "Original", value: "keep" },
  { label: "44.1 kHz", value: 44100 },
  { label: "22 kHz", value: 22050 },
  { label: "11 kHz", value: 11025 },
];

function Toggle(props: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.on} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        {props.label}
        {props.hint && <span className="dim small"> {props.hint}</span>}
      </span>
    </label>
  );
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function ExportPanel({ data, fx, clipName }: Props) {
  const [opts, setOpts] = useState<ExportOptions>(DEFAULT_EXPORT);
  const [name, setName] = useState(() => clipName.replace(/\.[^.]+$/, ""));
  const [includeFx, setIncludeFx] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const pending = !isNeutral(fx);
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  // Cheap size estimate from the clip as it stands (skips effects and silence trimming).
  const estimate = useMemo(() => {
    const prepared = prepareAudio(data, { ...opts, trimSilence: false, softEdges: false });
    return { bytes: estimateBytes(prepared, opts), secs: durationSeconds(prepared) };
  }, [data, opts]);

  const canShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  const build = async (): Promise<{ blob: Blob; fileName: string }> => {
    const source = pending && includeFx ? applyEffects(data, fx, FREE_CLIP_SECONDS) : data;
    // Let the "Preparing…" message paint before the heavy work.
    await new Promise((r) => setTimeout(r, 30));
    const blob = await exportAudio(source, opts);
    return { blob, fileName: safeFileName(name, FORMAT_INFO[opts.format].ext) };
  };

  const run = async (kind: "download" | "share" | "image") => {
    setBusy(true);
    setError(null);
    setStatus("Preparing…");
    try {
      let blob: Blob;
      let fileName: string;
      if (kind === "image") {
        const source = pending && includeFx ? applyEffects(data, fx, FREE_CLIP_SECONDS) : data;
        blob = await renderWaveformPng(source);
        fileName = safeFileName(name, "png");
      } else {
        ({ blob, fileName } = await build());
      }
      if (!alive.current) return;
      if (kind === "share") {
        const file = new File([blob], fileName, { type: blob.type });
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: fileName });
            setStatus("Shared.");
          } catch (e) {
            if ((e as Error).name === "AbortError") setStatus(null);
            else throw e;
          }
        } else {
          saveBlob(blob, fileName);
          setStatus(`Sharing isn't available here, so ${fileName} was downloaded instead.`);
        }
      } else {
        saveBlob(blob, fileName);
        setStatus(`Saved ${fileName} (${formatBytes(blob.size)}). Check your Downloads.`);
      }
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const formats = Object.keys(FORMAT_INFO) as ExportFormat[];

  return (
    <div className="fx-panel">
      <div className="fx-card">
        <label className="slider-head" htmlFor="export-name">
          File name
        </label>
        <input
          id="export-name"
          className="text-input"
          value={name}
          maxLength={80}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="fx-card">
        <h3>Format</h3>
        <div className="seg">
          {formats.map((f) => (
            <button key={f} className={opts.format === f ? "on" : ""} onClick={() => set("format", f)}>
              {FORMAT_INFO[f].label}
            </button>
          ))}
        </div>
        <p className="dim small">{FORMAT_INFO[opts.format].hint}</p>
        {opts.format === "ogg" && (
          <p className="dim small">OGG won't play in Safari on iPhone, but game engines like Godot, Unity and GameMaker read it.</p>
        )}

        {opts.format === "wav" && (
          <div className="seg">
            {([16, 24] as const).map((b) => (
              <button key={b} className={opts.wavBits === b ? "on" : ""} onClick={() => set("wavBits", b)}>
                {b}-bit
              </button>
            ))}
          </div>
        )}
        {opts.format === "mp3" && (
          <div className="seg">
            {([96, 128, 192, 256, 320] as const).map((k) => (
              <button key={k} className={opts.mp3Kbps === k ? "on" : ""} onClick={() => set("mp3Kbps", k)}>
                {k}k
              </button>
            ))}
          </div>
        )}
        {opts.format === "ogg" && (
          <label className="slider">
            <span className="slider-head">
              <span>Quality</span>
              <span className="slider-value">{opts.oggQuality}</span>
            </span>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={opts.oggQuality}
              onChange={(e) => set("oggQuality", Number(e.target.value))}
            />
          </label>
        )}
      </div>

      <div className="fx-card">
        <h3>Game-ready options</h3>
        <p className="dim small">Sample rate</p>
        <div className="seg">
          {RATES.map((r) => (
            <button key={r.label} className={opts.sampleRate === r.value ? "on" : ""} onClick={() => set("sampleRate", r.value)}>
              {r.label}
            </button>
          ))}
        </div>
        <Toggle label="Mono" hint="Half the size, best for sound effects" on={opts.mono} onChange={(v) => set("mono", v)} />
        <Toggle label="Trim silence" hint="Cut dead air at the start and end" on={opts.trimSilence} onChange={(v) => set("trimSilence", v)} />
        <Toggle label="Soft edges" hint="Tiny fades so loops don't click" on={opts.softEdges} onChange={(v) => set("softEdges", v)} />
        {pending && (
          <Toggle
            label="Include effects not yet applied"
            hint="Your Effects tab settings"
            on={includeFx}
            onChange={setIncludeFx}
          />
        )}
      </div>

      <p className="selection-info dim">
        About {formatBytes(estimate.bytes)} · {formatTime(estimate.secs)}
      </p>

      <div className="fx-bar">
        <button className="btn-primary small-btn wide" disabled={busy} onClick={() => run("download")}>
          {busy ? "Working…" : `Download ${FORMAT_INFO[opts.format].label}`}
        </button>
        {canShare && (
          <button className="btn-chip" disabled={busy} onClick={() => run("share")}>
            Share
          </button>
        )}
      </div>
      <button className="btn-secondary img-btn" disabled={busy} onClick={() => run("image")}>
        Save waveform picture (PNG)
      </button>

      {status && <p className="notice">{status}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
