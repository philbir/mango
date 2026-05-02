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

const FALLBACK_MODELS: ModelOption[] = [
  { id: "sonnet", name: "Claude Sonnet (latest)", vendor: "anthropic" },
  { id: "opus", name: "Claude Opus (latest)", vendor: "anthropic" },
  { id: "haiku", name: "Claude Haiku (latest)", vendor: "anthropic" },
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    vendor: "anthropic",
  },
  {
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    vendor: "anthropic",
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    vendor: "anthropic",
  },
];

const detectClaudeAuth = (): boolean => {
  if (process.env.ANTHROPIC_API_KEY) return true;
  const home = homedir();
  const candidates = [
    path.join(home, ".claude"),
    path.join(home, ".config", "claude"),
    path.join(home, "Library", "Application Support", "Claude"),
  ];
  return candidates.some((p) => existsSync(p));
};

const FENCED_FILTER_INSTRUCTIONS = `

You will respond in EXACTLY this format and nothing else:

\`\`\`json
{
  "filter": <the MongoDB filter document>,
  "explanation": "<one sentence>"
}
\`\`\`

Do not invoke any tool. Do not write any prose outside the fenced JSON block.`;

const FENCED_COMMAND_INSTRUCTIONS = `

You will respond in EXACTLY this format and nothing else:

\`\`\`json
{
  "command": "<the JavaScript expression>",
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

interface SdkResultMessage {
  type: "result";
  subtype?: string;
  result?: string;
  is_error?: boolean;
}

const runQuery = async (
  systemPrompt: string,
  userPrompt: string,
  modelId: string | undefined,
): Promise<{ text: string; model: string }> => {
  const sdk = await import("@anthropic-ai/claude-agent-sdk").catch((e) => {
    throw new Error(
      `Could not load @anthropic-ai/claude-agent-sdk: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
  const queryFn = (
    sdk as unknown as {
      query: (params: {
        prompt: string;
        options?: Record<string, unknown>;
      }) => AsyncIterable<unknown>;
    }
  ).query;

  let resultText = "";
  let modelOut = modelId ?? "";
  for await (const msg of queryFn({
    prompt: userPrompt,
    options: {
      systemPrompt,
      model: modelId,
      tools: [],
      allowedTools: [],
      maxTurns: 1,
      permissionMode: "default",
    },
  })) {
    const m = msg as SdkResultMessage & { model?: string };
    if (m.type === "result") {
      if (m.is_error) {
        throw new Error(
          `Claude Agent SDK reported an error: ${m.result ?? "(no detail)"}`,
        );
      }
      if (typeof m.result === "string") resultText = m.result;
      if (typeof m.model === "string") modelOut = m.model;
    }
  }

  if (!resultText) {
    throw new Error("Claude Agent SDK returned no result.");
  }
  return { text: resultText, model: modelOut || modelId || "claude" };
};

export interface ClaudeCodeBuildOptions {
  model?: string;
}

export const buildClaudeCodeProvider = (
  opts: ClaudeCodeBuildOptions = {},
): AiProvider => {
  const model = opts.model ?? process.env.AI_MODEL ?? "sonnet";

  return {
    name: "claude-code",
    configured: detectClaudeAuth(),
    model,
    setupHint:
      "Either set ANTHROPIC_API_KEY, or run the Claude Code CLI once to log in (creds at ~/.claude). The SDK then authenticates automatically.",
    async listModels(): Promise<ModelOption[]> {
      return FALLBACK_MODELS;
    },
    async query(input: AiQueryInput): Promise<AiQueryResult> {
      const useModel = input.model ?? model;
      const system =
        buildSystemPrompt(input.collection, input.schemaText) +
        FENCED_FILTER_INSTRUCTIONS;
      const { text, model: modelOut } = await runQuery(
        system,
        input.prompt,
        useModel,
      );
      const parsed = extractJsonObject(text);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        !("filter" in (parsed as Record<string, unknown>))
      ) {
        throw new Error(
          `Could not extract a filter JSON from the model response. Raw: ${
            text.slice(0, 240) || "(empty)"
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
        model: modelOut,
      };
    },
    async generateCommand(input: AiCommandInput): Promise<AiCommandResult> {
      const useModel = input.model ?? model;
      const system =
        buildCommandSystemPrompt(input.schemaText) +
        FENCED_COMMAND_INSTRUCTIONS;
      const { text, model: modelOut } = await runQuery(
        system,
        input.prompt,
        useModel,
      );
      const parsed = extractJsonObject(text);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        !("command" in (parsed as Record<string, unknown>))
      ) {
        throw new Error(
          `Could not extract a command from the model response. Raw: ${
            text.slice(0, 240) || "(empty)"
          }`,
        );
      }
      const obj = parsed as { command?: string; explanation?: string };
      return {
        command: obj.command ?? "",
        explanation: obj.explanation ?? "",
        model: modelOut,
      };
    },
  };
};
