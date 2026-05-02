import OpenAI from "openai";
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

const FALLBACK_OPENAI_MODELS: ModelOption[] = [
  { id: "gpt-4o-mini", name: "GPT-4o mini", vendor: "openai" },
  { id: "gpt-4o", name: "GPT-4o", vendor: "openai" },
  { id: "gpt-4.1", name: "GPT-4.1", vendor: "openai" },
  { id: "gpt-4.1-mini", name: "GPT-4.1 mini", vendor: "openai" },
  { id: "o1-mini", name: "o1-mini (reasoning)", vendor: "openai" },
];

export interface OpenAiBuildOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export const buildOpenAiProvider = (
  opts: OpenAiBuildOptions = {},
): AiProvider => {
  const apiKey = opts.apiKey ?? process.env.AI_API_KEY ?? "";
  const baseUrl = opts.baseUrl ?? process.env.AI_BASE_URL ?? undefined;
  const model = opts.model ?? process.env.AI_MODEL ?? "gpt-4o-mini";

  return {
    name: "openai",
    configured: !!apiKey,
    model,
    baseUrl: baseUrl ?? "https://api.openai.com/v1",
    setupHint:
      "Set AI_API_KEY (and optionally AI_BASE_URL, AI_MODEL). Works with OpenAI, GitHub Models, Azure OpenAI, or any OpenAI-compatible endpoint.",
    async listModels(): Promise<ModelOption[]> {
      if (!apiKey) return FALLBACK_OPENAI_MODELS;
      try {
        const client = new OpenAI({ apiKey, baseURL: baseUrl });
        const list = await client.models.list();
        const seen = new Set<string>();
        const items: ModelOption[] = [];
        for (const m of list.data ?? []) {
          if (!m.id || seen.has(m.id)) continue;
          seen.add(m.id);
          items.push({
            id: m.id,
            name: m.id,
            vendor: typeof m.owned_by === "string" ? m.owned_by : undefined,
          });
        }
        items.sort((a, b) => a.id.localeCompare(b.id));
        return items.length > 0 ? items : FALLBACK_OPENAI_MODELS;
      } catch {
        return FALLBACK_OPENAI_MODELS;
      }
    },
    async query(input: AiQueryInput): Promise<AiQueryResult> {
      if (!apiKey) {
        throw new Error("AI_API_KEY is not set.");
      }
      const useModel = input.model ?? model;
      const client = new OpenAI({ apiKey, baseURL: baseUrl });
      const completion = await client.chat.completions.create({
        model: useModel,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(input.collection, input.schemaText),
          },
          { role: "user", content: input.prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "propose_filter",
              description:
                "Propose a MongoDB filter document for the user's query.",
              parameters: {
                type: "object",
                properties: {
                  filter: {
                    type: "object",
                    description: "The MongoDB filter document.",
                    additionalProperties: true,
                  },
                  explanation: {
                    type: "string",
                    description:
                      "One or two sentences explaining what the filter does.",
                  },
                },
                required: ["filter", "explanation"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "propose_filter" },
        },
      });

      const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall || toolCall.type !== "function") {
        throw new Error(
          "AI did not return a tool call. Try rephrasing your prompt.",
        );
      }

      const args = JSON.parse(toolCall.function.arguments) as {
        filter: Record<string, unknown>;
        explanation: string;
      };

      return {
        filter: args.filter ?? {},
        explanation: args.explanation ?? "",
        model: completion.model,
      };
    },
    async generateCommand(input: AiCommandInput): Promise<AiCommandResult> {
      if (!apiKey) {
        throw new Error("AI_API_KEY is not set.");
      }
      const useModel = input.model ?? model;
      const client = new OpenAI({ apiKey, baseURL: baseUrl });
      const completion = await client.chat.completions.create({
        model: useModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: buildCommandSystemPrompt(input.schemaText) },
          { role: "user", content: input.prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "propose_command",
              description:
                "Propose a single mongo-shell JavaScript expression for the user's request.",
              parameters: {
                type: "object",
                properties: {
                  command: {
                    type: "string",
                    description:
                      "JavaScript expression like db.users.find({age:{$gte:18}}).sort({name:1}).limit(20)",
                  },
                  explanation: {
                    type: "string",
                    description:
                      "One or two sentences explaining what the command does.",
                  },
                },
                required: ["command", "explanation"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "propose_command" },
        },
      });

      const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall || toolCall.type !== "function") {
        throw new Error(
          "AI did not return a tool call. Try rephrasing your prompt.",
        );
      }
      const args = JSON.parse(toolCall.function.arguments) as {
        command: string;
        explanation: string;
      };
      return {
        command: args.command ?? "",
        explanation: args.explanation ?? "",
        model: completion.model,
      };
    },
  };
};
