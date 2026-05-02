import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  type AiCommandInput,
  type AiCommandResult,
  type AiProvider,
  type AiQueryInput,
  type AiQueryResult,
  type ModelOption,
  buildCommandSystemPrompt,
  buildSystemPrompt,
} from "./types.js";

const detectCopilotAuth = (): boolean => {
  if (process.env.GITHUB_TOKEN) return true;
  const home = homedir();
  const candidates = [
    path.join(home, ".copilot"),
    path.join(home, ".config", "github-copilot"),
    path.join(home, "Library", "Application Support", "GitHub Copilot"),
  ];
  return candidates.some((p) => existsSync(p));
};

let cachedClient: unknown = null;

const getClient = async () => {
  if (cachedClient) return cachedClient;
  const sdk = await import("@github/copilot-sdk").catch((e) => {
    throw new Error(
      `Could not load @github/copilot-sdk: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
  const ClientCtor = (sdk as { CopilotClient: new (opts: object) => unknown })
    .CopilotClient;
  const client = new ClientCtor({
    gitHubToken: process.env.GITHUB_TOKEN || undefined,
  }) as { start: () => Promise<void> };
  await client.start();
  cachedClient = client;
  return cachedClient;
};

const COPILOT_INSTRUCTIONS = `

You will respond in EXACTLY this format and nothing else:

\`\`\`json
{
  "filter": <the MongoDB filter document>,
  "explanation": "<one sentence>"
}
\`\`\`

Do not invoke any tool. Do not write any prose outside the fenced JSON block.`;

const extractJsonObject = (text: string): unknown | null => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : text;
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    // Try to locate the first JSON object in the text
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
};

export interface CopilotBuildOptions {
  model?: string;
}

export const buildCopilotProvider = (
  opts: CopilotBuildOptions = {},
): AiProvider => {
  const model = opts.model ?? process.env.AI_MODEL ?? "claude-sonnet-4.5";

  return {
    name: "copilot",
    configured: detectCopilotAuth(),
    model,
    setupHint:
      "Either set GITHUB_TOKEN with Copilot access, or run the Copilot CLI once to log in. The SDK will then authenticate automatically.",
    async listModels(): Promise<ModelOption[]> {
      try {
        const client = (await getClient()) as {
          listModels: () => Promise<
            Array<{
              id: string;
              name?: string;
              billing?: { multiplier?: number };
              policy?: { state?: string };
            }>
          >;
        };
        const models = await client.listModels();
        return models
          .map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            description:
              typeof m.billing?.multiplier === "number"
                ? `${m.billing.multiplier}×`
                : undefined,
          }))
          .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
      } catch {
        return [
          { id: "gpt-5", name: "GPT-5" },
          { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
          { id: "gpt-4o", name: "GPT-4o" },
        ];
      }
    },
    async query(input: AiQueryInput): Promise<AiQueryResult> {
      const sdk = await import("@github/copilot-sdk").catch((e) => {
        throw new Error(
          `Could not load @github/copilot-sdk: ${e instanceof Error ? e.message : String(e)}`,
        );
      });

      const client = (await getClient()) as {
        createSession: (cfg: object) => Promise<{
          on: (event: string, handler: (e: unknown) => void) => () => void;
          sendAndWait: (opts: { prompt: string }) => Promise<unknown>;
          disconnect: () => Promise<void>;
        }>;
      };

      const useModel = input.model ?? model;
      const session = await client.createSession({
        model: useModel,
        onPermissionRequest: (sdk as { approveAll: unknown }).approveAll,
        systemMessage: {
          mode: "replace" as const,
          content:
            buildSystemPrompt(input.collection, input.schemaText) +
            COPILOT_INSTRUCTIONS,
        },
      });

      let lastMessage = "";
      session.on("assistant.message", (event: unknown) => {
        const data = (event as { data?: { content?: string } }).data;
        if (data?.content) lastMessage = data.content;
      });

      try {
        await session.sendAndWait({ prompt: input.prompt });
      } finally {
        await session.disconnect().catch(() => {
          /* ignore */
        });
      }

      const parsed = extractJsonObject(lastMessage);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        !("filter" in (parsed as Record<string, unknown>))
      ) {
        throw new Error(
          `Could not extract a filter JSON from the model response. Raw: ${
            lastMessage.slice(0, 240) || "(empty)"
          }`,
        );
      }

      const obj = parsed as {
        filter: Record<string, unknown>;
        explanation?: string;
      };

      return {
        filter: obj.filter ?? {},
        explanation: obj.explanation ?? "",
        model: useModel,
      };
    },
    async generateCommand(input: AiCommandInput): Promise<AiCommandResult> {
      const sdk = await import("@github/copilot-sdk").catch((e) => {
        throw new Error(
          `Could not load @github/copilot-sdk: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
      const client = (await getClient()) as {
        createSession: (cfg: object) => Promise<{
          on: (event: string, handler: (e: unknown) => void) => () => void;
          sendAndWait: (opts: { prompt: string }) => Promise<unknown>;
          disconnect: () => Promise<void>;
        }>;
      };
      const useModel = input.model ?? model;
      const session = await client.createSession({
        model: useModel,
        onPermissionRequest: (sdk as { approveAll: unknown }).approveAll,
        systemMessage: {
          mode: "replace" as const,
          content:
            buildCommandSystemPrompt(input.schemaText) +
            `

You will respond in EXACTLY this format and nothing else:

\`\`\`json
{
  "command": "<the JavaScript expression>",
  "explanation": "<one sentence>"
}
\`\`\`

Do not invoke any tool. Do not write any prose outside the fenced JSON block.`,
        },
      });

      let lastMessage = "";
      session.on("assistant.message", (event: unknown) => {
        const data = (event as { data?: { content?: string } }).data;
        if (data?.content) lastMessage = data.content;
      });

      try {
        await session.sendAndWait({ prompt: input.prompt });
      } finally {
        await session.disconnect().catch(() => {});
      }

      const parsed = extractJsonObject(lastMessage);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        !("command" in (parsed as Record<string, unknown>))
      ) {
        throw new Error(
          `Could not extract a command from the model response. Raw: ${
            lastMessage.slice(0, 240) || "(empty)"
          }`,
        );
      }
      const obj = parsed as { command?: string; explanation?: string };
      return {
        command: obj.command ?? "",
        explanation: obj.explanation ?? "",
        model: useModel,
      };
    },
  };
};
