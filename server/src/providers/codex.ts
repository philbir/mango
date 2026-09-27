import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  type AiChatInput,
  type AiChatResult,
  type AiProvider,
  type ModelOption,
} from "./types.js";

// Locate the user's `codex` CLI (OpenAI Codex). Like the Copilot / Claude Code
// providers we spawn it per request rather than bundling an SDK. Chat goes
// through `codex exec`; the model list comes from `codex app-server`, which
// only exists in current builds — older npm installs (0.2x) can't list models
// and can't run the models a ChatGPT account now defaults to either.
interface LocatedCli {
  command: string;
  found: boolean;
  source: "override" | "env" | "candidate" | "where" | "path" | "fallback";
}

export interface CodexCliDetection {
  ok: boolean;
  path: string | null;
  source: LocatedCli["source"];
  version: string | null;
  error?: string;
}

const isExecutableFile = (candidate: string): boolean => {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const findCliOnPath = (): string | null => {
  const names =
    process.platform === "win32" ? ["codex.cmd", "codex.exe", "codex"] : ["codex"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
};

const findCliWithWhere = (): string | null => {
  const attempts: Array<[string, string[]]> =
    process.platform === "win32"
      ? [["where", ["codex"]]]
      : [
          ["zsh", ["-lc", "where codex"]],
          ["sh", ["-lc", "command -v codex"]],
        ];

  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    if (result.status !== 0) continue;
    const candidate = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && isExecutableFile(line));
    if (candidate) return candidate;
  }
  return null;
};

// Current builds understand `exec --ephemeral`; it's the cheapest reliable
// marker for "new enough to have app-server + model/list". (`app-server --help`
// is no good — old builds treat unknown words as a prompt and exit 0.)
const modernCache = new Map<string, boolean>();
const isModernCli = (cliPath: string): boolean => {
  const hit = modernCache.get(cliPath);
  if (hit !== undefined) return hit;
  const result = spawnSync(cliPath, ["exec", "--help"], {
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const modern = result.status === 0 && result.stdout.includes("--ephemeral");
  modernCache.set(cliPath, modern);
  return modern;
};

const locateCli = (override?: string | null): LocatedCli => {
  const cleanedOverride = override?.trim();
  if (cleanedOverride) {
    return {
      command: cleanedOverride,
      found: isExecutableFile(cleanedOverride),
      source: "override",
    };
  }

  const envOverride = process.env.MANGO_CODEX_CLI?.trim();
  if (envOverride) {
    return {
      command: envOverride,
      found: isExecutableFile(envOverride),
      source: "env",
    };
  }

  const home = homedir();
  const found: LocatedCli[] = [];
  const candidates = [
    path.join(home, ".npm-global", "bin", "codex"),
    path.join(home, ".local", "bin", "codex"),
    path.join(home, ".bun", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  for (const c of candidates) {
    if (isExecutableFile(c)) found.push({ command: c, found: true, source: "candidate" });
  }
  const whereCli = findCliWithWhere();
  if (whereCli) found.push({ command: whereCli, found: true, source: "where" });
  const pathCli = findCliOnPath();
  if (pathCli) found.push({ command: pathCli, found: true, source: "path" });
  // The ChatGPT / Codex desktop apps ship an auto-updated CLI. Checked last so
  // a user-installed one wins, but it rescues setups where that one is stale.
  if (process.platform === "darwin") {
    for (const app of ["ChatGPT.app", "Codex.app"]) {
      const c = path.join("/Applications", app, "Contents", "Resources", "codex");
      if (isExecutableFile(c)) found.push({ command: c, found: true, source: "candidate" });
    }
  }

  const first = found[0];
  if (!first) return { command: "codex", found: false, source: "fallback" };
  return found.find((c) => isModernCli(c.command)) ?? first;
};

const detectCodexAuth = (): boolean => {
  if (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY) return true;
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
  return existsSync(path.join(codexHome, "auth.json"));
};

const tooOldError = (cliPath: string): Error =>
  new Error(
    `Codex CLI at "${cliPath}" is too old to list models. Update it (npm i -g @openai/codex@latest) or point Mango at a current build, e.g. /Applications/ChatGPT.app/Contents/Resources/codex.`,
  );

const runCliVersion = async (cliPath: string): Promise<string> =>
  await new Promise((resolve, reject) => {
    const child = spawn(cliPath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Codex CLI version check timed out for "${cliPath}".`));
    }, 5_000);

    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not run Codex CLI at "${cliPath}": ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const versionLine = `${stdout}\n${stderr}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^codex/i.test(line));
      if (code === 0 && versionLine) return resolve(versionLine);
      reject(
        new Error(
          `Codex CLI version check failed with ${code}: ${stderr.trim() || stdout.trim() || "(no output)"}`,
        ),
      );
    });
  });

export const detectCodexCli = async (
  override?: string | null,
): Promise<CodexCliDetection> => {
  const cli = locateCli(override);
  if (!cli.found) {
    return {
      ok: false,
      path: cli.source === "fallback" ? null : cli.command,
      source: cli.source,
      version: null,
      error:
        cli.source === "fallback"
          ? "Could not find Codex CLI in common install paths or PATH."
          : `Codex CLI path "${cli.command}" does not exist or is not executable.`,
    };
  }

  try {
    const version = await runCliVersion(cli.command);
    if (!isModernCli(cli.command)) {
      return {
        ok: false,
        path: cli.command,
        source: cli.source,
        version,
        error: tooOldError(cli.command).message,
      };
    }
    return { ok: true, path: cli.command, source: cli.source, version };
  } catch (e) {
    return {
      ok: false,
      path: cli.command,
      source: cli.source,
      version: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

interface AppServerModel {
  id?: unknown;
  model?: unknown;
  displayName?: unknown;
  description?: unknown;
  hidden?: unknown;
  isDefault?: unknown;
}

interface AppServerMessage {
  id?: number;
  result?: { data?: AppServerModel[] };
  error?: { message?: string };
}

// `codex app-server` speaks JSON-RPC over stdio: initialize → initialized →
// model/list. The response is the account's picker catalog; the account's
// default model is flagged `isDefault` and we sort it first so the chat box
// picks it when nothing else is selected.
const queryModelsViaAppServer = async (cliPath: string): Promise<ModelOption[]> =>
  await new Promise((resolve, reject) => {
    const child = spawn(cliPath, ["app-server"], {
      cwd: tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    let buffered = "";
    let stderr = "";
    let settled = false;
    const finish = (err: Error | null, models?: ModelOption[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (err) reject(err);
      else resolve(models ?? []);
    };
    const send = (msg: Record<string, unknown>) =>
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    const timer = setTimeout(
      () => finish(new Error("Codex CLI model list timed out.")),
      30_000,
    );

    child.stdout.on("data", (b: Buffer) => {
      buffered += b.toString();
      let nl: number;
      while ((nl = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (!line) continue;
        let msg: AppServerMessage;
        try {
          msg = JSON.parse(line) as AppServerMessage;
        } catch {
          continue;
        }
        if (msg.id !== 1 && msg.id !== 2) continue;
        if (msg.error) {
          return finish(
            new Error(`Codex CLI: ${msg.error.message ?? "app-server request failed"}`),
          );
        }
        if (msg.id === 1) {
          send({ method: "initialized" });
          send({ id: 2, method: "model/list", params: {} });
          continue;
        }
        const entries = (msg.result?.data ?? []).filter((m) => m.hidden !== true);
        entries.sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true));
        const models = entries.flatMap((m): ModelOption[] => {
          const id =
            typeof m.model === "string" ? m.model : typeof m.id === "string" ? m.id : null;
          if (!id) return [];
          return [
            {
              id,
              name: typeof m.displayName === "string" ? m.displayName : id,
              ...(typeof m.description === "string" ? { description: m.description } : {}),
              vendor: "openai",
            },
          ];
        });
        if (models.length === 0) {
          return finish(new Error("Codex CLI returned no models."));
        }
        return finish(null, models);
      }
    });
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", (e) =>
      finish(new Error(`Could not run Codex CLI at "${cliPath}": ${e.message}`)),
    );
    child.on("close", (code) =>
      finish(
        new Error(
          `Codex CLI exited with ${code} before listing models: ${stderr.trim() || "(no stderr)"}`,
        ),
      ),
    );

    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "mango", title: "Mango", version: "1.0.0" } },
    });
  });

const MODEL_CACHE_TTL_MS = 10 * 60_000;
const modelCache = new Map<string, { at: number; models: ModelOption[] }>();

const listCliModels = async (cliPath: string): Promise<ModelOption[]> => {
  const hit = modelCache.get(cliPath);
  if (hit && Date.now() - hit.at < MODEL_CACHE_TTL_MS) return hit.models;
  if (!isModernCli(cliPath)) throw tooOldError(cliPath);
  const models = await queryModelsViaAppServer(cliPath);
  modelCache.set(cliPath, { at: Date.now(), models });
  return models;
};

const runQuery = async (
  systemPrompt: string,
  userPrompt: string,
  modelId: string | undefined,
  cliPath: string,
): Promise<{ text: string; model: string }> => {
  // `codex exec` has no system-prompt flag that works across versions, so the
  // instructions are inlined like the Copilot provider does. The reply is read
  // from --output-last-message rather than parsing the --json event stream,
  // whose shape has changed between releases.
  const combined = `## Instructions\n\n${systemPrompt}\n\n## Request\n\n${userPrompt}`;
  const outDir = mkdtempSync(path.join(tmpdir(), "mango-codex-"));
  const outFile = path.join(outDir, "last-message.txt");

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--output-last-message",
    outFile,
  ];
  // Keep Mango's requests out of the user's Codex history, and skip their
  // config.toml (MCP servers, notify hooks, …) — auth lives in auth.json and
  // is still picked up.
  if (isModernCli(cliPath)) {
    args.push("--ephemeral", "--ignore-user-config", "--ignore-rules");
  }
  if (modelId) args.push("--model", modelId);
  args.push("-");

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(cliPath, args, {
        cwd: outDir,
        stdio: ["pipe", "ignore", "pipe"],
        env: { ...process.env, NO_COLOR: "1" },
      });
      let stderr = "";
      child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
      child.on("error", (e) =>
        reject(
          new Error(
            `Could not spawn Codex CLI at "${cliPath}": ${e.message}. Install Codex (npm i -g @openai/codex) or set MANGO_CODEX_CLI to its full path.`,
          ),
        ),
      );
      child.on("close", (code) => {
        let text = "";
        try {
          text = readFileSync(outFile, "utf8").trim();
        } catch {
          // No file — handled below.
        }
        if (!text) {
          const tail = stderr.trim().split(/\r?\n/).slice(-5).join("\n");
          return reject(
            new Error(
              `Codex CLI exited with ${code} without a reply: ${tail || "(no stderr)"}`,
            ),
          );
        }
        resolve({ text, model: modelId ?? "codex" });
      });
      child.stdin.write(combined);
      child.stdin.end();
    });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};

export interface CodexBuildOptions {
  model?: string;
  cliPath?: string | null;
}

export const buildCodexProvider = (opts: CodexBuildOptions = {}): AiProvider => {
  // No hardcoded default: an empty model lets Codex use the account default,
  // and the chat box pre-selects the `isDefault` entry from the live list.
  const model = opts.model ?? process.env.AI_MODEL ?? "";
  const cli = locateCli(opts.cliPath);
  const authFound = detectCodexAuth();

  const setupHint = !cli.found
    ? cli.source === "override" || cli.source === "env"
      ? `Codex CLI path "${cli.command}" does not exist. Set the full path in AI settings or MANGO_CODEX_CLI.`
      : "Install the Codex CLI (npm i -g @openai/codex) and run `codex login` once. Mango checks common locations, PATH and the ChatGPT app, and you can set the full path in AI settings or MANGO_CODEX_CLI."
    : authFound
      ? `Codex CLI found at ${cli.command}. Mango will spawn it for each request.`
      : `Codex CLI found at ${cli.command}. Run \`codex login\` once, or set OPENAI_API_KEY.`;

  return {
    name: "codex",
    configured: cli.found && authFound,
    model,
    setupHint,
    async validate(): Promise<Record<string, string | number | boolean | null>> {
      const detection = await detectCodexCli(cli.command);
      if (!detection.ok) throw new Error(detection.error ?? "Codex CLI not found.");
      await listCliModels(cli.command);
      return {
        cliPath: detection.path,
        cliVersion: detection.version,
        modelSource: "Codex CLI (live account catalog)",
      };
    },
    async listModels(): Promise<ModelOption[]> {
      try {
        return await listCliModels(cli.command);
      } catch {
        return [];
      }
    },
    async chat(input: AiChatInput): Promise<AiChatResult> {
      const useModel = input.model || model || undefined;
      const history = input.messages
        .map((m) =>
          m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`,
        )
        .join("\n\n");
      const lastUser = input.messages
        .slice()
        .reverse()
        .find((m) => m.role === "user");
      if (!lastUser) {
        return { text: "", model: useModel ?? "codex" };
      }
      const userPrompt =
        input.messages.length > 1
          ? `Conversation so far:\n\n${history}\n\nReply to the latest user message.`
          : lastUser.content;
      return await runQuery(input.systemPrompt, userPrompt, useModel, cli.command);
    },
  };
};
