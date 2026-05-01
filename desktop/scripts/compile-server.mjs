#!/usr/bin/env node
// Compile the @mango/server source into a single native binary using `bun build --compile`.
// The output is named after the Rust target triple Tauri expects in `externalBin`.
//
// Usage:  yarn compile-server          (builds for current platform)
//         yarn compile-server <triple> (e.g. aarch64-apple-darwin, x86_64-pc-windows-msvc)
//
// Requires: bun installed and on PATH (https://bun.sh).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const repoRoot = resolve(desktopDir, "..");
const serverEntry = resolve(repoRoot, "server/src/index.ts");
const binDir = resolve(desktopDir, "bin");

const TRIPLE_TO_BUN_TARGET = {
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-apple-darwin": "darwin-x64",
  "x86_64-unknown-linux-gnu": "linux-x64",
  "x86_64-pc-windows-msvc": "windows-x64",
};

const detectHostTriple = () => {
  const r = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(
      "Could not detect host triple via `rustc -vV`. Install rustup, or pass the triple explicitly: " +
        Object.keys(TRIPLE_TO_BUN_TARGET).join(", "),
    );
  }
  const m = r.stdout.match(/^host:\s*(\S+)/m);
  if (!m) throw new Error("`rustc -vV` did not include a host triple.");
  return m[1];
};

const triple = process.argv[2] ?? detectHostTriple();
const bunTarget = TRIPLE_TO_BUN_TARGET[triple];
if (!bunTarget) {
  console.error(`Unsupported triple: ${triple}`);
  console.error(`Supported: ${Object.keys(TRIPLE_TO_BUN_TARGET).join(", ")}`);
  process.exit(2);
}

mkdirSync(binDir, { recursive: true });
const outFile = resolve(
  binDir,
  triple.includes("windows") ? `mango-server-${triple}.exe` : `mango-server-${triple}`,
);

if (!existsSync(serverEntry)) {
  throw new Error(`Server entry not found: ${serverEntry}`);
}

console.log(`[mango] compiling sidecar:`);
console.log(`         entry  : ${serverEntry}`);
console.log(`         target : ${bunTarget}`);
console.log(`         output : ${outFile}`);

const r = spawnSync(
  "bun",
  [
    "build",
    "--compile",
    `--target=bun-${bunTarget}`,
    serverEntry,
    "--outfile",
    outFile,
  ],
  { stdio: "inherit" },
);

if (r.error) {
  console.error("Could not invoke `bun`. Install Bun: https://bun.sh");
  process.exit(2);
}
process.exit(r.status ?? 1);
