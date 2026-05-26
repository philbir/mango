#!/usr/bin/env node
// Sync the desktop-bundle version across the four files tauri-action reads
// from. Used by .github/workflows/desktop-build.yml right before bundling so
// the asset filenames (Mango_X.Y.Z_*) always match the git tag — even when a
// release PR forgot to bump these files (which is how 0.3.3 → 0.3.6 shipped
// as `Mango_0.3.2_*.dmg`). Run locally with:  node desktop/scripts/sync-version.mjs 0.4.0
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const version = process.argv[2];
if (!version || !/^[0-9]+\.[0-9]+\.[0-9]+([-+].+)?$/.test(version)) {
  console.error(
    `Usage: sync-version.mjs <X.Y.Z>\nGot: ${JSON.stringify(version)}`,
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const tauriDir = resolve(desktopRoot, "src-tauri");

const updates = [];

// 1. desktop/package.json + 2. desktop/src-tauri/tauri.conf.json — JSON
// rewrites use parse/stringify to preserve correct formatting.
for (const file of [
  resolve(desktopRoot, "package.json"),
  resolve(tauriDir, "tauri.conf.json"),
]) {
  const text = readFileSync(file, "utf8");
  const doc = JSON.parse(text);
  if (doc.version === version) {
    updates.push({ file, before: doc.version, after: version, changed: false });
    continue;
  }
  const before = doc.version;
  doc.version = version;
  // Match the pretty-printed style git already tracks (2-space indent, LF).
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  updates.push({ file, before, after: version, changed: true });
}

// 3. desktop/src-tauri/Cargo.toml — patch the [package] version line. Anchor
// on `[package]` so we don't accidentally touch a `[dependencies]` entry.
const cargoTomlPath = resolve(tauriDir, "Cargo.toml");
{
  const text = readFileSync(cargoTomlPath, "utf8");
  let inPackage = false;
  let changed = false;
  let before = null;
  const out = text.split("\n").map((line) => {
    if (/^\[package\]/.test(line)) {
      inPackage = true;
      return line;
    }
    if (inPackage && /^\[/.test(line)) inPackage = false;
    if (inPackage) {
      const m = line.match(/^version\s*=\s*"([^"]+)"\s*$/);
      if (m) {
        before = m[1];
        if (m[1] === version) return line;
        changed = true;
        return `version = "${version}"`;
      }
    }
    return line;
  });
  if (changed) writeFileSync(cargoTomlPath, out.join("\n"));
  updates.push({ file: cargoTomlPath, before, after: version, changed });
}

// 4. desktop/src-tauri/Cargo.lock — patch ONLY the mango-desktop entry. The
// `[[package]]` block lists `name = ...` then `version = ...` on the next
// non-blank line; replace that one.
const cargoLockPath = resolve(tauriDir, "Cargo.lock");
{
  const text = readFileSync(cargoLockPath, "utf8");
  const lines = text.split("\n");
  let changed = false;
  let before = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'name = "mango-desktop"') {
      // Walk forward to the next `version = "…"` line within this block.
      for (let j = i + 1; j < lines.length && !lines[j].startsWith("[["); j++) {
        const m = lines[j].match(/^version = "([^"]+)"$/);
        if (m) {
          before = m[1];
          if (m[1] !== version) {
            lines[j] = `version = "${version}"`;
            changed = true;
          }
          break;
        }
      }
      break;
    }
  }
  if (changed) writeFileSync(cargoLockPath, lines.join("\n"));
  updates.push({ file: cargoLockPath, before, after: version, changed });
}

for (const u of updates) {
  const rel = u.file.replace(`${desktopRoot}/`, "desktop/");
  const status = u.changed ? "updated" : "already";
  console.log(`[sync-version] ${status.padEnd(8)} ${rel}: ${u.before} → ${u.after}`);
}
