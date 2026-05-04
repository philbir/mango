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

// Bun's default `linux-x64` / `windows-x64` targets emit AVX2 instructions and
// SIGILL on CPUs without it (Proxmox `kvm64`, older Intel Atom/Celeron, some
// cloud VMs). The `-baseline` variants build for plain x86_64 and run anywhere.
// Cost is a marginal startup-time hit — worth it for "it just runs".
//
// Caveat: `windows-x64-baseline` was disabled in 0.2.7 because bun's
// cross-target downloader crashes ("Failed to extract executable for
// 'bun-windows-x64-baseline-v1.3.x'") when the host bun is `windows-x64` and
// the target is the baseline variant. AVX2-less Windows is rare in practice
// (much more common on the cheap Linux VPS that the Linux baseline targets);
// switch back once the upstream extraction bug is fixed.
const TRIPLE_TO_BUN_TARGET = {
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-apple-darwin": "darwin-x64",
  "x86_64-unknown-linux-gnu": "linux-x64-baseline",
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

// The Claude Code and GitHub Copilot providers shell out to the user's
// installed `claude` / `copilot` CLIs (see server/src/providers/*.ts) instead
// of importing the JS SDKs — that keeps the desktop sidecar binary lean and
// avoids the SDKs' platform-native addons that crash bun-compile on Windows.
// As a result, we no longer need to mark them as external.
const externals = [];

const r = spawnSync(
  "bun",
  [
    "build",
    "--compile",
    `--target=bun-${bunTarget}`,
    ...externals.flatMap((m) => ["--external", m]),
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
if (r.status !== 0) {
  process.exit(r.status ?? 1);
}

// On macOS, `bun build --compile` emits a non-standard signature that
// `codesign` later refuses to overwrite ("invalid or unsupported format for
// signature"), breaking tauri's bundle step on signed builds. Strip it and
// re-apply a standard ad-hoc signature so:
//   - tauri's bundle step can overwrite cleanly with `codesign --force --sign <Developer ID>`
//   - local `tauri:dev` runs (no signing step) get a launchable binary;
//     a fully unsigned binary is SIGKILLed by the macOS kernel at exec.
// No-op on non-macOS hosts.
if (process.platform === "darwin" && triple.includes("apple-darwin")) {
  const strip = spawnSync("codesign", ["--remove-signature", outFile], {
    stdio: "inherit",
  });
  if (strip.status !== 0) {
    console.error(
      `[mango] codesign --remove-signature failed (exit ${strip.status}). ` +
        `tauri-action's signing step may fail with "invalid or unsupported format for signature".`,
    );
    process.exit(strip.status ?? 1);
  }
  const adhoc = spawnSync(
    "codesign",
    ["--sign", "-", "--force", outFile],
    { stdio: "inherit" },
  );
  if (adhoc.status !== 0) {
    console.error(
      `[mango] ad-hoc codesign failed (exit ${adhoc.status}). ` +
        `The unsigned sidecar will be SIGKILLed at launch on macOS.`,
    );
    process.exit(adhoc.status ?? 1);
  }
}
