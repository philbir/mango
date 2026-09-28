#!/usr/bin/env node
// Stamp the release version into every file that carries it. The git tag is
// the single source of truth — the repo itself holds `0.0.0-dev`, and CI runs
// this right after checkout on a tag build (desktop-build.yml,
// docker-publish.yml), so nobody bumps versions by hand anymore.
//
//   node scripts/set-version.mjs 0.6.0
//
// Files: root/ui/server/desktop package.json, desktop/src-tauri/tauri.conf.json,
// the [package] version in Cargo.toml, and the mango-desktop entry in Cargo.lock.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^[0-9]+\.[0-9]+\.[0-9]+([-+].+)?$/.test(version)) {
  console.error(`Usage: set-version.mjs <X.Y.Z>\nGot: ${JSON.stringify(version)}`);
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = resolve(root, "desktop/src-tauri");
const updates = [];

// JSON files: parse/stringify keeps the tracked 2-space + trailing-LF style.
for (const rel of [
  "package.json",
  "ui/package.json",
  "server/package.json",
  "desktop/package.json",
  "desktop/src-tauri/tauri.conf.json",
]) {
  const file = resolve(root, rel);
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const before = doc.version;
  if (before !== version) {
    doc.version = version;
    writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  }
  updates.push({ file, before, changed: before !== version });
}

// Cargo.toml — only the [package] version line, never a dependency's.
{
  const file = resolve(tauriDir, "Cargo.toml");
  let inPackage = false;
  let before = null;
  const out = readFileSync(file, "utf8").split("\n").map((line) => {
    if (/^\[/.test(line)) inPackage = /^\[package\]/.test(line);
    const m = inPackage && before === null && line.match(/^version\s*=\s*"([^"]+)"\s*$/);
    if (!m) return line;
    before = m[1];
    return `version = "${version}"`;
  });
  if (before !== version) writeFileSync(file, out.join("\n"));
  updates.push({ file, before, changed: before !== version });
}

// Cargo.lock — only the mango-desktop [[package]] entry's version line.
{
  const file = resolve(tauriDir, "Cargo.lock");
  const lines = readFileSync(file, "utf8").split("\n");
  let before = null;
  const i = lines.indexOf('name = "mango-desktop"');
  for (let j = i + 1; i >= 0 && j < lines.length && !lines[j].startsWith("[["); j++) {
    const m = lines[j].match(/^version = "([^"]+)"$/);
    if (m) {
      before = m[1];
      lines[j] = `version = "${version}"`;
      break;
    }
  }
  if (before === null) {
    console.error("[set-version] mango-desktop entry not found in Cargo.lock");
    process.exit(1);
  }
  if (before !== version) writeFileSync(file, lines.join("\n"));
  updates.push({ file, before, changed: before !== version });
}

for (const u of updates) {
  const status = u.changed ? "updated" : "already";
  console.log(`[set-version] ${status.padEnd(8)} ${relative(root, u.file)}: ${u.before} → ${version}`);
}
