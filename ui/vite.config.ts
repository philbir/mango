import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// API target for the Vite proxy. Override with VITE_MANGO_API to point at a
// different mango-server instance (default: localhost:5180, Hono's default).
const apiTarget = process.env.VITE_MANGO_API ?? "http://localhost:5180";

// Tauri's default devUrl is http://localhost:5173 — keep Vite on that port so
// `yarn tauri:dev` finds it. Override with VITE_PORT for browser-only dev if
// you have a port collision. PORT is honored too so the Aspire AppHost's
// default-allocated endpoint (apphost.ts) just works.
const port = Number(process.env.PORT ?? process.env.VITE_PORT ?? 5173);

const resolveVersion = () => {
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }
  try {
    return execSync("git describe --tags --abbrev=0", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    return `v${pkg.version ?? "0.0.0"}`;
  }
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_MANGO_VERSION": JSON.stringify(resolveVersion()),
    "import.meta.env.VITE_MANGO_DOCS_URL": JSON.stringify(
      "https://philbir.github.io/mango/",
    ),
  },
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
