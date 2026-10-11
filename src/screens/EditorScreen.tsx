import { useEffect, useMemo, useRef, useState } from "react";
import { formatTime, type Clip } from "../audio/clip";
import { type AudioData, durationSeconds, lengthSamples } from "../audio/data";
import { insert, markRange, remove, slice } from "../audio/edit";
import { cloneEffects, DEFAULT_EFFECTS, isNeutral } from "../audio/effects";
import { canRedo, canUndo, createHistory, current, push, redo, undo } from "../audio/history";
import { useEffectsPreview } from "../audio/useEffectsPreview";
import { encodeWav } from "../audio/wav";
import { FREE_CLIP_SECONDS } from "../config";
import EffectsPanel from "../components/EffectsPanel";
import Waveform, { type Restore, type Selection, type WaveformHandle } from "../components/Waveform";

interface Props {
  clip: Clip;
  onClose: () => void;
}

type Tab = "edit" | "effects";

function ToolButton(props: { label: string; icon: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button className="tool" disabled={props.disabled} onClick={props.onClick}>
      <span className="tool-icon" aria-hidden="true">
        {props.icon}
      </span>
      <span>{props.label}</span>
    </button>
  );
}

export default function EditorScreen({ clip, onClose }: Props) {
  const waveRef = useRef<WaveformHandle>(null);
  /** What the waveform should restore on its next reload. Edits set this; otherwise the playhead is kept. */
  const pendingRestoreRef = useRef<Restore | null>(null);

  const [tab, setTab] = useState<Tab>("edit");
  const [history, setHistory] = useState(() => createHistory<AudioData>(clip.data));
  const [clipboard, setClipboard] = useState<AudioData | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ url: string; restore: Restore } | null>(null);

  const [fx, setFx] = useState(() => cloneEffects(DEFAULT_EFFECTS));
  const [hearOriginal, setHearOriginal] = useState(false);

  const data = current(history);
  const preview = useEffectsPreview(data, fx, tab === "effects", FREE_CLIP_SECONDS);

  // What you hear: the processed version while on the Effects tab, otherwise the edited clip.
  const playData = useMemo(
    () => (tab === "effects" && !hearOriginal && preview.result ? preview.result : data),
    [tab, hearOriginal, preview.result, data],
  );
  const total = durationSeconds(data);

  // Turn the audio being played into a file the waveform can load.
  useEffect(() => {
    const u = URL.createObjectURL(encodeWav(playData));
    const restore = pendingRestoreRef.current ?? {
      time: waveRef.current?.getTime() ?? 0,
      selection: null,
    };
    pendingRestoreRef.current = null;
    setLoaded({ url: u, restore });
    return () => URL.revokeObjectURL(u);
  }, [playData]);

  const commit = (next: AudioData, after: Restore) => {
    setMessage(null);
    pendingRestoreRef.current = after;
    setHistory((h) => push(h, next));
  };

  const trim = () => {
    if (!selection) return;
    commit(slice(data, selection.start, selection.end), { time: 0, selection: null });
  };

  const removeSelection = (toClipboard: boolean) => {
    if (!selection) return;
    const next = remove(data, selection.start, selection.end);
    if (lengthSamples(next) === 0) {
      setMessage("That would remove the whole clip. Use Undo or pick a smaller part.");
      return;
    }
    if (toClipboard) setClipboard(slice(data, selection.start, selection.end));
    commit(next, { time: selection.start, selection: null });
  };

  const copy = () => {
    if (!selection) return;
    const piece = slice(data, selection.start, selection.end);
    setClipboard(piece);
    setMessage(`Copied ${durationSeconds(piece).toFixed(1)}s`);
  };

  const paste = () => {
    if (!clipboard) return;
    const at = Math.min(waveRef.current?.getTime() ?? 0, total);
    const pasteLen = durationSeconds(clipboard);
    if (total + pasteLen > FREE_CLIP_SECONDS + 0.05) {
      setMessage(`Free clips are limited to ${FREE_CLIP_SECONDS}s. Premium will remove the limit.`);
      return;
    }
    commit(insert(data, at, clipboard), { time: at, selection: { start: at, end: at + pasteLen } });
  };

  const selectAll = () => waveRef.current?.select({ start: 0, end: total });

  const mark = (edge: "start" | "end") => {
    const range = markRange(selection, waveRef.current?.getTime() ?? 0, total, edge);
    if (range) waveRef.current?.select(range);
    else setMessage("Move the playhead first (tap the waveform), then set the start or end.");
  };

  const doUndo = () => {
    setMessage(null);
    pendingRestoreRef.current = { time: waveRef.current?.getTime() ?? 0, selection: null };
    setHistory((h) => undo(h));
  };

  const doRedo = () => {
    setMessage(null);
    pendingRestoreRef.current = { time: waveRef.current?.getTime() ?? 0, selection: null };
    setHistory((h) => redo(h));
  };

  const switchTab = (next: Tab) => {
    setMessage(null);
    setHearOriginal(false);
    setTab(next);
  };

  const neutral = isNeutral(fx);

  const applyEffectsToClip = () => {
    if (!preview.result || preview.processing) return;
    commit(preview.result, { time: 0, selection: null });
    setFx(cloneEffects(DEFAULT_EFFECTS));
    setHearOriginal(false);
    setMessage("Effects applied. You can undo this in the Edit tab.");
  };

  return (
    <section className="screen">
      <header className="topbar">
        <button className="btn-text" onClick={onClose}>
          ‹ Home
        </button>
        <h2>{clip.name}</h2>
        <span className="dim small">{formatTime(durationSeconds(playData))}</span>
      </header>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "edit"} className={tab === "edit" ? "on" : ""} onClick={() => switchTab("edit")}>
          Edit
        </button>
        <button
          role="tab"
          aria-selected={tab === "effects"}
          className={tab === "effects" ? "on" : ""}
          onClick={() => switchTab("effects")}
        >
          Effects
        </button>
      </div>

      {loaded && <Waveform ref={waveRef} url={loaded.url} restore={loaded.restore} onSelectionChange={setSelection} />}

      {tab === "edit" && (
        <>
          <p className="selection-info dim">
            {selection
              ? `Selected ${formatTime(selection.start)} to ${formatTime(selection.end)} (${(selection.end - selection.start).toFixed(2)}s)`
              : "Drag on the waveform to select a part, or tap it to move the playhead and use Set start / Set end."}
          </p>

          <div className="select-row">
            <button className="btn-chip" onClick={() => mark("start")}>
              Set start
            </button>
            <button className="btn-chip" onClick={() => mark("end")}>
              Set end
            </button>
            <button className="btn-chip" onClick={selectAll}>
              Select all
            </button>
          </div>

          <div className="toolbar">
            <ToolButton icon="✂" label="Trim" disabled={!selection} onClick={trim} />
            <ToolButton icon="⌫" label="Cut" disabled={!selection} onClick={() => removeSelection(true)} />
            <ToolButton icon="⧉" label="Copy" disabled={!selection} onClick={copy} />
            <ToolButton icon="⎘" label="Paste" disabled={!clipboard} onClick={paste} />
            <ToolButton icon="✕" label="Delete" disabled={!selection} onClick={() => removeSelection(false)} />
            <ToolButton icon="↶" label="Undo" disabled={!canUndo(history)} onClick={doUndo} />
            <ToolButton icon="↷" label="Redo" disabled={!canRedo(history)} onClick={doRedo} />
          </div>
        </>
      )}

      {tab === "effects" && (
        <>
          <div className="fx-bar">
            <button
              className={`btn-chip ${hearOriginal ? "on" : ""}`}
              disabled={neutral}
              onClick={() => setHearOriginal((v) => !v)}
              aria-pressed={hearOriginal}
            >
              {hearOriginal ? "Hearing original" : "Hear original"}
            </button>
            <button className="btn-chip" disabled={neutral} onClick={() => setFx(cloneEffects(DEFAULT_EFFECTS))}>
              Reset
            </button>
            <button
              className="btn-primary small-btn"
              disabled={neutral || preview.processing || !preview.result}
              onClick={applyEffectsToClip}
            >
              Apply
            </button>
          </div>

          <p className="selection-info dim">
            {preview.processing
              ? "Processing…"
              : neutral
                ? "Pick a preset or switch an effect on, then press play."
                : "Press play to hear it. Apply keeps the result in your clip."}
          </p>

          {preview.truncated && !preview.processing && (
            <p className="notice">The end was cut off to stay within the free {FREE_CLIP_SECONDS}s limit.</p>
          )}

          <EffectsPanel params={fx} onChange={setFx} />
        </>
      )}

      {message && <p className="notice">{message}</p>}

      <div className="placeholder-card">
        <p>
          <strong>Coming next</strong>
        </p>
        <p className="dim">Export to WAV, MP3 or OGG.</p>
      </div>
    </section>
  );
}
