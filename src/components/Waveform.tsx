import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { formatTime } from "../audio/clip";

interface Props {
  url: string;
}

export default function Waveform({ url }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const loopRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    setReady(false);
    setPlaying(false);
    setTime(0);

    const ws = WaveSurfer.create({
      container: containerRef.current,
      url,
      height: 140,
      waveColor: "#5a4bb8",
      progressColor: "#9d86ff",
      cursorColor: "#ffffff",
      cursorWidth: 2,
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      normalize: true,
      dragToSeek: true,
    });
    wsRef.current = ws;

    ws.on("ready", (d) => {
      setDuration(d);
      setReady(true);
    });
    ws.on("timeupdate", (t) => setTime(t));
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => {
      if (loopRef.current) {
        void ws.play(0);
      } else {
        setPlaying(false);
      }
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [url]);

  const toggle = () => {
    void wsRef.current?.playPause();
  };

  const toggleLoop = () => {
    loopRef.current = !loopRef.current;
    setLoop(loopRef.current);
  };

  return (
    <div className="waveform-card">
      <div ref={containerRef} className="waveform" />
      <div className="transport">
        <button className="btn-round" onClick={toggle} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="time">
          {formatTime(time)} <span className="dim">/ {formatTime(duration)}</span>
        </div>
        <button className={`btn-chip ${loop ? "on" : ""}`} onClick={toggleLoop} disabled={!ready}>
          Loop
        </button>
      </div>
    </div>
  );
}
