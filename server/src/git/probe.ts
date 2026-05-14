import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface GitInfo {
  rootIsRepo: boolean;
  branch?: string;
  shortSha?: string;
  dirty?: boolean;
}

const TIMEOUT_MS = 1500;

const run = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await exec("git", args, {
    cwd,
    timeout: TIMEOUT_MS,
    maxBuffer: 256 * 1024,
  });
  return stdout.trim();
};

/**
 * Soft-fail on every error — a folder that isn't a git repo, a missing `git`
 * binary, or a slow `git status` should just hide the badge in the UI rather
 * than 500 the request.
 */
export const probeGit = async (folderPath: string): Promise<GitInfo> => {
  let isRepo = false;
  try {
    const out = await run(["rev-parse", "--is-inside-work-tree"], folderPath);
    isRepo = out === "true";
  } catch {
    return { rootIsRepo: false };
  }
  if (!isRepo) return { rootIsRepo: false };

  const [branch, shortSha, status] = await Promise.all([
    run(["rev-parse", "--abbrev-ref", "HEAD"], folderPath).catch(() => ""),
    run(["rev-parse", "--short", "HEAD"], folderPath).catch(() => ""),
    run(["status", "--porcelain"], folderPath).catch(() => null as string | null),
  ]);

  return {
    rootIsRepo: true,
    branch: branch || undefined,
    shortSha: shortSha || undefined,
    dirty: status === null ? undefined : status.length > 0,
  };
};
