import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// API target for the Vite proxy. Override with VITE_MANGO_API to point at a
// different mango-server instance (default: localhost:5180, Hono's default).
const apiTarget = process.env.VITE_MANGO_API ?? "http://localhost:5180";

// Tauri's default devUrl is http://localhost:5173 — keep Vite on that port so
// `yarn tauri:dev` finds it. Override with VITE_PORT for browser-only dev if
// you have a port collision.
const port = Number(process.env.VITE_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../server/public",
    emptyOutDir: true,
  },
});
