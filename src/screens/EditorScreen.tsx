import { useEffect, useRef, useState } from "react";
import { formatTime, type Clip } from "../audio/clip";
import { type AudioData, durationSeconds, lengthSamples } from "../audio/data";
import { insert, remove, slice } from "../audio/edit";
import { canRedo, canUndo, createHistory, current, push, redo, undo } from "../audio/history";
import { encodeWav } from "../audio/wav";
import { FREE_CLIP_SECONDS } from "../config";
import Waveform, { type Restore, type Selection, type WaveformHandle } from "../components/Waveform";

interface Props {
  clip: Clip;
  onClose: () => void;
}

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
  const [history, setHistory] = useState(() => createHistory<AudioData>(clip.data));
  const [clipboard, setClipboard] = useState<AudioData | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [restore, setRestore] = useState<Restore | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const data = current(history);
  const total = durationSeconds(data);

  // Re-render the audio into a playable file whenever the edit changes.
  useEffect(() => {
    const u = URL.createObjectURL(encodeWav(data));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);

  const commit = (next: AudioData, after: Restore) => {
    setMessage(null);
    setRestore(after);
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

  const doUndo = () => {
    setMessage(null);
    setRestore({ time: waveRef.current?.getTime() ?? 0, selection: null });
    setHistory((h) => undo(h));
  };

  const doRedo = () => {
    setMessage(null);
    setRestore({ time: waveRef.current?.getTime() ?? 0, selection: null });
    setHistory((h) => redo(h));
  };

  return (
    <section className="screen">
      <header className="topbar">
        <button className="btn-text" onClick={onClose}>
          ‹ Home
        </button>
        <h2>{clip.name}</h2>
        <span className="dim small">{formatTime(total)}</span>
      </header>

      {url && <Waveform ref={waveRef} url={url} restore={restore} onSelectionChange={setSelection} />}

      <p className="selection-info dim">
        {selection
          ? `Selected ${formatTime(selection.start)} to ${formatTime(selection.end)} (${(selection.end - selection.start).toFixed(2)}s)`
          : "Drag on the waveform to select a part. Tap to move the playhead."}
      </p>

      <div className="toolbar">
        <ToolButton icon="⬚" label="Select all" onClick={selectAll} />
        <ToolButton icon="✂" label="Trim" disabled={!selection} onClick={trim} />
        <ToolButton icon="⌫" label="Cut" disabled={!selection} onClick={() => removeSelection(true)} />
        <ToolButton icon="⧉" label="Copy" disabled={!selection} onClick={copy} />
        <ToolButton icon="⎘" label="Paste" disabled={!clipboard} onClick={paste} />
        <ToolButton icon="✕" label="Delete" disabled={!selection} onClick={() => removeSelection(false)} />
        <ToolButton icon="↶" label="Undo" disabled={!canUndo(history)} onClick={doUndo} />
        <ToolButton icon="↷" label="Redo" disabled={!canRedo(history)} onClick={doRedo} />
      </div>

      {message && <p className="notice">{message}</p>}

      <div className="placeholder-card">
        <p>
          <strong>Coming next</strong>
        </p>
        <p className="dim">
          Pitch, speed, reverb, EQ and 8-bit effects, then export to WAV, MP3 or OGG.
        </p>
        <p className="dim small">
          Trim keeps the selected part. Cut and Delete remove it. Paste inserts at the playhead.
        </p>
      </div>
    </section>
  );
}
