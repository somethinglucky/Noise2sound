import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const api = { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } };

export default defineConfig({
  // In development the API runs separately (npm run dev:server); in production Caddy routes /api.
  server: { proxy: api },
  preview: { proxy: api },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: { navigateFallbackDenylist: [/^\/api\//] },
      manifest: {
        name: "Noise2sound",
        short_name: "Noise2sound",
        description: "Turn your voice and noises into game-ready sounds.",
        theme_color: "#0b0b10",
        background_color: "#0b0b10",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
    }),
  ],
});
