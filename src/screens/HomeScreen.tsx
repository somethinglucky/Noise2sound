import { useRef } from "react";

interface Props {
  onRecord: () => void;
  onUpload: (file: File) => void;
  message: string | null;
}

export default function HomeScreen({ onRecord, onUpload, message }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <section className="screen center">
      <div className="brand">
        <img src="/icon.svg" alt="" width={72} height={72} />
        <h1>Noise2sound</h1>
        <p className="dim">Hum it, record it, shape it into game-ready sound.</p>
      </div>

      <div className="actions">
        <button className="btn-primary" onClick={onRecord}>
          <span className="dot" /> Record
        </button>
        <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
          Upload audio
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      {message && <p className="error">{message}</p>}
    </section>
  );
}
