import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The Aspire CLI restores the TypeScript AppHost with
// `pnpm install --ignore-workspace`, which skips pnpm-workspace.yaml. Security
// pins kept there were silently dropped from pnpm-lock.yaml on every
// `aspire run`, breaking `pnpm install --frozen-lockfile` in CI. They now live
// in the root package.json (`pnpm.overrides`), which both install modes read.
const repoRoot = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

/** Top-level `overrides:` block of pnpm-lock.yaml as a name → spec map. */
function lockfileOverrides(): Record<string, string> {
  const block = /^overrides:\n((?: {2}.+\n)+)/m.exec(read("pnpm-lock.yaml"))?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = /^ {2}(.+?):\s*(.+)$/.exec(line);
    if (m?.[1] && m[2]) out[m[1].replace(/^'|'$/g, "")] = m[2].replace(/^'|'$/g, "");
  }
  return out;
}

describe("pnpm security pins", () => {
  const pins = (JSON.parse(read("package.json")) as { pnpm?: { overrides?: Record<string, string> } }).pnpm
    ?.overrides;

  it("live in the root package.json", () => {
    expect(pins && Object.keys(pins).length).toBeTruthy();
  });

  it("are not (also) declared in pnpm-workspace.yaml", () => {
    expect(
      /^overrides:/m.test(read("pnpm-workspace.yaml")),
      "move `overrides:` from pnpm-workspace.yaml into package.json `pnpm.overrides` — Aspire's `pnpm install --ignore-workspace` ignores the workspace file",
    ).toBe(false);
  });

  it("match the overrides recorded in pnpm-lock.yaml", () => {
    expect(
      lockfileOverrides(),
      "pnpm-lock.yaml lost or drifted from package.json `pnpm.overrides` — run `pnpm install` at the repo root and commit the lockfile",
    ).toEqual(pins);
  });
});
