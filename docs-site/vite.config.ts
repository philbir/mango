import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

// Honor Aspire-injected PORT so the Aspire AppHost can run docs alongside the
// UI without a 5173 collision. VITE_PORT also accepted for manual overrides.
const port = Number(process.env.PORT ?? process.env.VITE_PORT ?? 5174);

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    "import.meta.env.VITE_MANGO_VERSION": JSON.stringify(resolveVersion()),
    "import.meta.env.VITE_MANGO_REPO_URL": JSON.stringify(
      "https://github.com/philbir/mango",
    ),
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
