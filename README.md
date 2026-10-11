# Noise2sound

Hum, sing, play, or make a noise, then shape it into game-ready music and sound effects. Built for indie game developers. Runs entirely in the browser (installable as a PWA).

## Status: Milestone 2

- Record from the microphone (free tier capped at 15 seconds)
- Upload an existing audio file
- Waveform view with play/pause, seek, and loop
- Select a part by dragging on the waveform (handles to adjust), or Select all
- Trim (keep selection), Cut, Copy, Paste (at playhead), Delete, Undo/Redo (20 steps)
- Pasting past the free 15 second cap is blocked

Planned next: effects chain (pitch, speed, reverb, EQ, 8-bit), export to WAV/MP3/OGG, premium gating.

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

Vite, React, TypeScript, wavesurfer.js, vite-plugin-pwa. Audio processing runs client-side with the Web Audio API.
