import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/plugins/regions";
import { formatTime } from "../audio/clip";

export interface Selection {
  start: number;
  end: number;
}

export interface WaveformHandle {
  getTime: () => number;
  /** Select a range (seconds). Replaces any existing selection. */
  select: (sel: Selection) => void;
  clearSelection: () => void;
}

/** State to restore after the audio is reloaded (e.g. following an edit). */
export interface Restore {
  time: number;
  selection: Selection | null;
}

interface Props {
  url: string;
  restore?: Restore;
  onSelectionChange: (sel: Selection | null) => void;
}

const MIN_SELECTION = 0.01;

const Waveform = forwardRef<WaveformHandle, Props>(function Waveform(
  { url, restore, onSelectionChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const loopRef = useRef(false);
  /** Keep playing after the audio is swapped (e.g. while tweaking an effect). */
  const resumeRef = useRef(false);
  const restoreRef = useRef(restore);
  const onSelRef = useRef(onSelectionChange);
  restoreRef.current = restore;
  onSelRef.current = onSelectionChange;

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Create the player once.
  useEffect(() => {
    if (!containerRef.current) return;

    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 140,
      waveColor: "#5a4bb8",
      progressColor: "#9d86ff",
      cursorColor: "#ffffff",
      cursorWidth: 2,
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      normalize: false,
      dragToSeek: false,
      plugins: [regions],
    });
    wsRef.current = ws;
    regionsRef.current = regions;

    const emit = () => {
      const r = regions.getRegions()[0];
      onSelRef.current(r && r.end - r.start >= MIN_SELECTION ? { start: r.start, end: r.end } : null);
    };

    // Dragging on the waveform makes a selection; tapping seeks.
    regions.enableDragSelection({ color: "rgba(124, 92, 255, 0.3)" });
    regions.on("region-created", (region) => {
      regions.getRegions().forEach((other) => {
        if (other !== region) other.remove();
      });
      emit();
    });
    regions.on("region-updated", emit);
    regions.on("region-removed", emit);

    ws.on("ready", (d) => {
      setDuration(d);
      setReady(true);
      const r = restoreRef.current;
      if (r) {
        ws.setTime(Math.min(r.time, d));
        if (r.selection) {
          regions.addRegion({
            start: r.selection.start,
            end: Math.min(r.selection.end, d),
            color: "rgba(124, 92, 255, 0.3)",
            drag: true,
            resize: true,
          });
        }
      }
      if (resumeRef.current) {
        resumeRef.current = false;
        void ws.play();
      }
    });
    ws.on("timeupdate", (t) => setTime(t));
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => {
      if (loopRef.current) void ws.play(0);
      else setPlaying(false);
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
    };
  }, []);

  // Load (or reload) the audio whenever the URL changes.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    resumeRef.current = ws.isPlaying();
    setReady(false);
    setPlaying(false);
    regionsRef.current?.clearRegions();
    void ws.load(url);
  }, [url]);

  useImperativeHandle(ref, () => ({
    getTime: () => wsRef.current?.getCurrentTime() ?? 0,
    select: (sel) => {
      const regions = regionsRef.current;
      if (!regions) return;
      regions.clearRegions();
      regions.addRegion({
        start: sel.start,
        end: sel.end,
        color: "rgba(124, 92, 255, 0.3)",
        drag: true,
        resize: true,
      });
    },
    clearSelection: () => regionsRef.current?.clearRegions(),
  }));

  const toggleLoop = () => {
    loopRef.current = !loopRef.current;
    setLoop(loopRef.current);
  };

  return (
    <div className="waveform-card">
      <div ref={containerRef} className="waveform" />
      <div className="transport">
        <button
          className="btn-round"
          onClick={() => void wsRef.current?.playPause()}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
        >
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
});

export default Waveform;
