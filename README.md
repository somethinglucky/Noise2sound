# Noise2sound

Hum, sing, play, or make a noise, then shape it into game-ready music and sound effects. Built for indie game developers. Runs entirely in the browser (installable as a PWA).

## Status: Milestone 4 (export)

- Record from the microphone (free tier capped at 15 seconds)
- Upload an existing audio file
- Waveform view with play/pause, seek, and loop
- Select a part by dragging on the waveform (handles to adjust), by moving the playhead and tapping Set start / Set end, or with Select all
- Trim (keep selection), Cut, Copy, Paste (at playhead), Delete, Undo/Redo (20 steps)
- Pasting past the free 15 second cap is blocked
- Effects tab, in collapsible groups, with one-tap presets:
  - Clean up: Noise reduction (learns the noise from the quietest part), Noise gate, Filter (muffle / low cut)
  - Tone and pitch: Pitch (keeps length), Speed (keeps pitch), 3-band EQ
  - Character: Distortion, Robot, 8-bit (with a Smoothing control to cut the static)
  - Space: Echo, Reverb
  - Level: Volume (+/- 24 dB, Normalize, soft limiter so boosts don't crackle)
- Shape tools on the Edit tab: Reverse, Fade in, Fade out, Mute, Duplicate, Add pause
- Effects preview in a background worker, "Hear original" before/after toggle, Apply to keep the result (undoable)
- Free tier: results are cut at 15 seconds (e.g. a long reverb tail)

- Export tab: WAV (16 or 24-bit), MP3 (96-320 kbps) or OGG Vorbis (quality 0-10)
- Game-ready options: sample rate (44.1 / 22 / 11 kHz), mono, trim silence, soft edges (no loop clicks)
- Optionally bakes in effects you haven't applied yet; file name box, size estimate
- Download, Share (iOS share sheet), and a waveform picture (PNG)
- OGG doesn't play in iPhone Safari, but game engines (Godot, Unity, GameMaker) read it

Planned next: premium gating, sheet music / key detection, auto-tune.

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests for the edit logic
npm run build      # type-check and production build into dist/
npm run preview    # serve the production build
```

Microphone access needs HTTPS (or localhost), so serve the built `dist/` over HTTPS in production (e.g. Caddy on the droplet).

## Stack

Vite, React, TypeScript, wavesurfer.js, @soundtouchjs/core (pitch shifting, MPL-2.0), vite-plugin-pwa, wasm-media-encoders (MP3/OGG). All audio processing runs client-side in the browser.
