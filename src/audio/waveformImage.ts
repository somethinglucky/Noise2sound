import { type AudioData, durationSeconds, lengthSamples } from "./data";

/** Draw the clip as a waveform picture (PNG) for docs, store pages or sharing. */
export function renderWaveformPng(a: AudioData, width = 1400, height = 420): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Couldn't draw the picture in this browser."));

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#14141d");
  bg.addColorStop(1, "#0b0b10");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const pad = 40;
  const labelH = 44;
  const plotW = width - pad * 2;
  const plotH = height - pad - labelH;
  const mid = pad + plotH / 2;
  const n = lengthSamples(a);
  const barW = 4;
  const gap = 2;
  const bars = Math.max(1, Math.floor(plotW / (barW + gap)));
  const per = Math.max(1, Math.floor(n / bars));

  let loudest = 0.0001;
  const peaks = new Float32Array(bars);
  for (let b = 0; b < bars; b++) {
    let peak = 0;
    const from = b * per;
    const to = Math.min(n, from + per);
    for (const ch of a.channels) for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(ch[i]));
    peaks[b] = peak;
    loudest = Math.max(loudest, peak);
  }

  const fill = ctx.createLinearGradient(0, pad, 0, pad + plotH);
  fill.addColorStop(0, "#b9a7ff");
  fill.addColorStop(1, "#6a4cff");
  ctx.fillStyle = fill;
  for (let b = 0; b < bars; b++) {
    const h = Math.max(3, (peaks[b] / loudest) * plotH);
    const x = pad + b * (barW + gap);
    const y = mid - h / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, h, 2);
    ctx.fill();
  }

  ctx.fillStyle = "#8d8da0";
  ctx.font = "600 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText("Noise2sound", pad, height - 16);
  ctx.textAlign = "right";
  ctx.fillText(`${durationSeconds(a).toFixed(2)} s`, width - pad, height - 16);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't make the picture."))), "image/png");
  });
}
