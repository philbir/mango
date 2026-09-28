import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { healthReport } from "../src/health.js";

describe("healthReport", () => {
  let dir: string;
  const previous = process.env.MANGO_DATA_DIR;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "mango-health-"));
    process.env.MANGO_DATA_DIR = dir;
  });

  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.MANGO_DATA_DIR;
    else process.env.MANGO_DATA_DIR = previous;
  });

  it("reports ok with the package version when the data dir is writable", () => {
    const report = healthReport();
    expect(report.ok).toBe(true);
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.checks).toEqual([{ name: "data-dir", ok: true, detail: dir }]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "fails the data-dir check when the directory is read-only",
    () => {
      chmodSync(dir, 0o500);
      const report = healthReport();
      expect(report.ok).toBe(false);
      expect(report.checks[0]).toMatchObject({ name: "data-dir", ok: false });
    },
  );
});
