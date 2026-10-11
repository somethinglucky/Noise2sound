import type { ReactNode } from "react";
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

function Card(props: { title: string; hint: string; on: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className={`fx-card ${props.on ? "on" : ""}`}>
      <header className="fx-head">
        <div>
          <h3>{props.title}</h3>
          <p className="dim small">{props.hint}</p>
        </div>
        <button
          className="switch"
          role="switch"
          aria-checked={props.on}
          aria-label={`${props.title} ${props.on ? "on" : "off"}`}
          onClick={props.onToggle}
        >
          <span className="knob" />
        </button>
      </header>
      <div className="fx-body">{props.children}</div>
    </section>
  );
}

const signed = (v: number, unit: string) => `${v > 0 ? "+" : ""}${v}${unit}`;

export default function EffectsPanel({ params, onChange }: Props) {
  /** Change some settings of one effect. Touching a slider switches that effect on. */
  function set<K extends keyof EffectsParams>(key: K, patch: Partial<EffectsParams[K]>, turnOn = true) {
    const next = cloneEffects(params);
    next[key] = { ...next[key], ...patch, ...(turnOn ? { on: true } : {}) };
    onChange(next);
  }

  const toggle = <K extends keyof EffectsParams>(key: K) => set(key, { on: !params[key].on } as Partial<EffectsParams[K]>, false);

  return (
    <div className="fx-panel">
      <div className="presets" role="group" aria-label="Presets">
        {PRESETS.map((p) => (
          <button key={p.id} className="btn-chip" onClick={() => onChange(cloneEffects(p.params))}>
            {p.label}
          </button>
        ))}
      </div>

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
      </Card>

      <Card title="Reverb" hint="Adds space and echo" on={params.reverb.on} onToggle={() => toggle("reverb")}>
        <Slider
          label="Room size"
          value={params.reverb.size}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set("reverb", { size: v })}
        />
        <Slider
          label="Damping"
          value={params.reverb.damp}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set("reverb", { damp: v })}
        />
        <Slider
          label="Mix"
          value={params.reverb.mix}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set("reverb", { mix: v })}
        />
      </Card>
    </div>
  );
}
