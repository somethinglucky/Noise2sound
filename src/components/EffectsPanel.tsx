import { type ReactNode, useState } from "react";
import { type EffectsParams, PRESETS, cloneEffects } from "../audio/effects";

interface Props {
  params: EffectsParams;
  onChange: (next: EffectsParams) => void;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <span className="slider-value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** A slider whose steps are spaced evenly in pitch/frequency terms (better for Hz values). */
function LogSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const { value, min, max } = props;
  const pos = Math.round((1000 * Math.log(Math.max(value, min) / min)) / Math.log(max / min));
  return (
    <Slider
      label={props.label}
      value={pos}
      min={0}
      max={1000}
      step={1}
      format={() => props.format(value)}
      onChange={(p) => props.onChange(Math.round(min * Math.pow(max / min, p / 1000)))}
    />
  );
}

function Card(props: { title: string; hint: string; on: boolean; onToggle: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`fx-card ${props.on ? "on" : ""}`}>
      <header className="fx-head">
        <button className="fx-title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span>
            <h3>{props.title}</h3>
            <p className="dim small">{props.hint}</p>
          </span>
          <span className={`chevron ${open ? "open" : ""}`} aria-hidden="true">
            ›
          </span>
        </button>
        <button
          className="switch"
          role="switch"
          aria-checked={props.on}
          aria-label={`${props.title} ${props.on ? "on" : "off"}`}
          onClick={() => {
            if (!props.on) setOpen(true);
            props.onToggle();
          }}
        >
          <span className="knob" />
        </button>
      </header>
      {open && <div className="fx-body">{props.children}</div>}
    </section>
  );
}

const signed = (v: number, unit: string) => `${v > 0 ? "+" : ""}${v}${unit}`;
const percent = (v: number) => `${Math.round(v * 100)}%`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${v} Hz`);

export default function EffectsPanel({ params, onChange }: Props) {
  /** Change some settings of one effect. Touching a slider switches that effect on. */
  function set<K extends keyof EffectsParams>(key: K, patch: Partial<EffectsParams[K]>, turnOn = true) {
    const next = cloneEffects(params);
    next[key] = { ...next[key], ...patch, ...(turnOn ? { on: true } : {}) };
    onChange(next);
  }

  const toggle = <K extends keyof EffectsParams>(key: K) =>
    set(key, { on: !params[key].on } as Partial<EffectsParams[K]>, false);

  return (
    <div className="fx-panel">
      <div className="presets" role="group" aria-label="Presets">
        {PRESETS.map((p) => (
          <button key={p.id} className="btn-chip" onClick={() => onChange(cloneEffects(p.params))}>
            {p.label}
          </button>
        ))}
      </div>

      <h4 className="section-label">Clean up</h4>

      <Card
        title="Noise reduction"
        hint="Removes hiss and background noise"
        on={params.clean.on}
        onToggle={() => toggle("clean")}
      >
        <Slider
          label="Reduction"
          value={params.clean.reduce}
          min={0}
          max={1}
          step={0.05}
          format={percent}
          onChange={(v) => set("clean", { reduce: v })}
        />
        <Slider
          label="Noise gate (silences quiet parts)"
          value={params.clean.gate}
          min={-80}
          max={-20}
          step={1}
          format={(v) => (v <= -79 ? "off" : `${v} dB`)}
          onChange={(v) => set("clean", { gate: v })}
        />
        <p className="dim small">
          Learns the noise from the quietest part of your clip, so it works best with a short pause of just background
          noise.
        </p>
      </Card>

      <Card
        title="Filter"
        hint="Muffle it or thin it out"
        on={params.filter.on}
        onToggle={() => toggle("filter")}
      >
        <LogSlider
          label="Muffle (cuts highs)"
          value={params.filter.low}
          min={300}
          max={20000}
          format={(v) => (v >= 19000 ? "off" : hz(v))}
          onChange={(v) => set("filter", { low: v })}
        />
        <LogSlider
          label="Low cut (removes rumble)"
          value={params.filter.high}
          min={20}
          max={2000}
          format={(v) => (v <= 25 ? "off" : hz(v))}
          onChange={(v) => set("filter", { high: v })}
        />
      </Card>

      <h4 className="section-label">Tone and pitch</h4>

      <Card title="Pitch" hint="Higher or lower, same length" on={params.pitch.on} onToggle={() => toggle("pitch")}>
        <Slider
          label="Shift"
          value={params.pitch.semitones}
          min={-12}
          max={12}
          step={0.5}
          format={(v) => signed(v, " st")}
          onChange={(v) => set("pitch", { semitones: v })}
        />
      </Card>

      <Card title="Speed" hint="Faster or slower, same pitch" on={params.speed.on} onToggle={() => toggle("speed")}>
        <Slider
          label="Speed"
          value={params.speed.factor}
          min={0.5}
          max={2}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => set("speed", { factor: v })}
        />
      </Card>

      <Card title="EQ" hint="Boost or cut lows, mids, highs" on={params.eq.on} onToggle={() => toggle("eq")}>
        <Slider
          label="Low"
          value={params.eq.low}
          min={-12}
          max={12}
          step={1}
          format={(v) => signed(v, " dB")}
          onChange={(v) => set("eq", { low: v })}
        />
        <Slider
          label="Mid"
          value={params.eq.mid}
          min={-12}
          max={12}
          step={1}
          format={(v) => signed(v, " dB")}
          onChange={(v) => set("eq", { mid: v })}
        />
        <Slider
          label="High"
          value={params.eq.high}
          min={-12}
          max={12}
          step={1}
          format={(v) => signed(v, " dB")}
          onChange={(v) => set("eq", { high: v })}
        />
      </Card>

      <h4 className="section-label">Character</h4>

      <Card title="Distortion" hint="Gritty, growly, overdriven" on={params.distort.on} onToggle={() => toggle("distort")}>
        <Slider
          label="Drive"
          value={params.distort.drive}
          min={0}
          max={1}
          step={0.05}
          format={percent}
          onChange={(v) => set("distort", { drive: v })}
        />
        <Slider
          label="Tone (dark to bright)"
          value={params.distort.tone}
          min={0}
          max={1}
          step={0.05}
          format={percent}
          onChange={(v) => set("distort", { tone: v })}
        />
      </Card>

      <Card title="Robot" hint="Metallic, alien voice" on={params.robot.on} onToggle={() => toggle("robot")}>
        <LogSlider
          label="Buzz rate"
          value={params.robot.freq}
          min={10}
          max={500}
          format={(v) => `${v} Hz`}
          onChange={(v) => set("robot", { freq: v })}
        />
        <Slider
          label="Amount"
          value={params.robot.mix}
          min={0}
          max={1}
          step={0.05}
          format={percent}
          onChange={(v) => set("robot", { mix: v })}
        />
      </Card>

      <Card title="8-bit" hint="Crunchy retro game sound" on={params.crush.on} onToggle={() => toggle("crush")}>
        <Slider
          label="Bit depth"
          value={params.crush.bits}
          min={2}
          max={16}
          step={1}
          format={(v) => (v >= 16 ? "off" : `${v} bit`)}
          onChange={(v) => set("crush", { bits: v })}
        />
        <Slider
          label="Downsample"
          value={params.crush.hold}
          min={1}
          max={16}
          step={1}
          format={(v) => (v <= 1 ? "off" : `÷${v}`)}
          onChange={(v) => set("crush", { hold: v })}
        />
        <Slider
          label="Smoothing (less static)"
          value={params.crush.smooth}
          min={0}
          max={1}
          step={0.05}
          format={percent}
          onChange={(v) => set("crush", { smooth: v })}
        />
      </Card>

      <h4 className="section-label">Space</h4>

      <Card title="Echo" hint="Repeats that fade away" on={params.echo.on} onToggle={() => toggle("echo")}>
        <Slider
          label="Time between echoes"
          value={params.echo.time}
          min={0.05}
          max={1}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(v) => set("echo", { time: v })}
        />
        <Slider
          label="Repeats"
          value={params.echo.feedback}
          min={0}
          max={0.9}
          step={0.05}
          format={percent}
          onChange={(v) => set("echo", { feedback: v })}
        />
        <Slider
          label="Mix"
          value={params.echo.mix}
          min={0}
          max={1}
          step={0.05}
          format={percent}
          onChange={(v) => set("echo", { mix: v })}
        />
      </Card>

      <Card title="Reverb" hint="Adds space and room" on={params.reverb.on} onToggle={() => toggle("reverb")}>
        <Slider
          label="Room size"
          value={params.reverb.size}
          min={0}
          max={1}
          step={0.05}
          format={percent}
          onChange={(v) => set("reverb", { size: v })}
        />
        <Slider
          label="Damping"
          value={params.reverb.damp}
          min={0}
          max={1}
          step={0.05}
          format={percent}
          onChange={(v) => set("reverb", { damp: v })}
        />
        <Slider
          label="Mix"
          value={params.reverb.mix}
          min={0}
          max={1}
          step={0.05}
          format={percent}
          onChange={(v) => set("reverb", { mix: v })}
        />
      </Card>

      <h4 className="section-label">Level</h4>

      <Card title="Volume" hint="Make it louder or quieter" on={params.volume.on} onToggle={() => toggle("volume")}>
        <Slider
          label="Volume"
          value={params.volume.db}
          min={-24}
          max={24}
          step={1}
          format={(v) => signed(v, " dB")}
          onChange={(v) => set("volume", { db: v })}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={params.volume.normalize}
            onChange={(e) => set("volume", { normalize: e.target.checked })}
          />
          <span>Make it as loud as possible first (normalize)</span>
        </label>
        <p className="dim small">A built-in limiter keeps loud boosts from crackling.</p>
      </Card>
    </div>
  );
}
