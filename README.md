# Noise2sound

Hum, sing, play, or make a noise, then shape it into game-ready music and sound effects. Built for indie game developers. Runs entirely in the browser (installable as a PWA).

## Status: Milestone 3

- Record from the microphone (free tier capped at 15 seconds)
- Upload an existing audio file
- Waveform view with play/pause, seek, and loop
- Select a part by dragging on the waveform (handles to adjust), by moving the playhead and tapping Set start / Set end, or with Select all
- Trim (keep selection), Cut, Copy, Paste (at playhead), Delete, Undo/Redo (20 steps)
- Pasting past the free 15 second cap is blocked
- Effects tab: Pitch (keeps length), Speed (keeps pitch), 3-band EQ, 8-bit/bitcrush, Reverb, plus one-tap presets
- Effects preview in a background worker, "Hear original" before/after toggle, Apply to keep the result (undoable)
- Free tier: results are cut at 15 seconds (e.g. a long reverb tail)

Planned next: export to WAV/MP3/OGG, premium gating.

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

Vite, React, TypeScript, wavesurfer.js, @soundtouchjs/core (pitch shifting, MPL-2.0), vite-plugin-pwa. All audio processing runs client-side in the browser.
