import type { Clip } from "../audio/clip";
import Waveform from "../components/Waveform";
import { formatTime } from "../audio/clip";

interface Props {
  clip: Clip;
  onClose: () => void;
}

export default function EditorScreen({ clip, onClose }: Props) {
  return (
    <section className="screen">
      <header className="topbar">
        <button className="btn-text" onClick={onClose}>
          ‹ Home
        </button>
        <h2>{clip.name}</h2>
        <span className="dim small">{formatTime(clip.durationSeconds)}</span>
      </header>

      <Waveform url={clip.url} />

      <div className="placeholder-card">
        <p>
          <strong>Coming next</strong>
        </p>
        <p className="dim">
          Trim, cut and paste, pitch, speed, reverb, EQ and 8-bit effects, then export to WAV, MP3 or
          OGG.
        </p>
      </div>
    </section>
  );
}
