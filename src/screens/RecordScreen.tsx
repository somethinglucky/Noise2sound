import { useAccount } from "../account/AccountContext";
import { useRecorder } from "../audio/useRecorder";
import { formatTime } from "../audio/clip";

interface Props {
  onRecorded: (blob: Blob) => void;
  onBack: () => void;
}

export default function RecordScreen({ onRecorded, onBack }: Props) {
  const { clipSeconds } = useAccount();
  const { state, elapsed, level, error, start, stop } = useRecorder({
    maxSeconds: clipSeconds,
    onFinished: onRecorded,
  });

  const recording = state === "recording";
  const progress = elapsed / clipSeconds;
  const R = 92;
  const C = 2 * Math.PI * R;

  return (
    <section className="screen center">
      <header className="topbar">
        <button className="btn-text" onClick={onBack} disabled={recording}>
          ‹ Back
        </button>
        <h2>Record</h2>
        <span />
      </header>

      <div className="record-wrap">
        <svg className="ring" viewBox="0 0 220 220" aria-hidden="true">
          <circle cx="110" cy="110" r={R} className="ring-bg" />
          <circle
            cx="110"
            cy="110"
            r={R}
            className="ring-fg"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            transform="rotate(-90 110 110)"
          />
        </svg>
        <button
          className={`record-btn ${recording ? "active" : ""}`}
          style={{ transform: `scale(${1 + level * 0.25})` }}
          onClick={recording ? stop : () => void start()}
          aria-label={recording ? "Stop recording" : "Start recording"}
        >
          <span className="record-icon" />
        </button>
      </div>

      <p className="timer">
        {formatTime(elapsed)} <span className="dim">/ {formatTime(clipSeconds)}</span>
      </p>
      <p className="hint">
        {recording ? "Tap to stop" : "Tap to record. Hum, sing, or make any noise."}
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
