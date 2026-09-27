import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconCheck,
  IconLoader2,
  IconPlugConnected,
  IconSearch,
  IconTrash,
  IconWebhook,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { type AiProviderId, ApiError, api } from "../../api/client";
import {
  ClaudeLogo,
  GithubCopilotLogo,
  OpenAiLogo,
} from "../../components/ProviderLogos";

interface Props {
  onClose: () => void;
}

type ProviderName = AiProviderId;

export const AiSettingsModal = ({ onClose }: Props) => {
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: ["ai-config"],
    queryFn: () => api.getAiConfig(),
    staleTime: 0,
  });

  const [provider, setProvider] = useState<ProviderName>("openai");
  const [apiKey, setApiKey] = useState<string>("");
  const [keepExistingKey, setKeepExistingKey] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [copilotCliPath, setCopilotCliPath] = useState("");
  const [claudeCliPath, setClaudeCliPath] = useState("");
  const [codexCliPath, setCodexCliPath] = useState("");
  const [allowDataSampling, setAllowDataSampling] = useState(false);

  useEffect(() => {
    if (!config.data) return;
    setProvider(config.data.provider ?? "openai");
    setBaseUrl(config.data.baseUrl ?? "");
    setModel(config.data.model ?? "");
    setCopilotCliPath(config.data.copilotCliPath ?? "");
    setClaudeCliPath(config.data.claudeCliPath ?? "");
    setCodexCliPath(config.data.codexCliPath ?? "");
    setKeepExistingKey(config.data.apiKeySet);
    setAllowDataSampling(config.data.allowDataSampling);
  }, [config.data]);

  const save = useMutation({
    mutationFn: () =>
      api.putAiConfig({
        provider,
        apiKey: keepExistingKey ? undefined : apiKey,
        baseUrl: baseUrl.trim() || null,
        model: model.trim() || null,
        copilotCliPath:
          provider === "copilot" ? copilotCliPath.trim() || null : undefined,
        claudeCliPath:
          provider === "claude-code" ? claudeCliPath.trim() || null : undefined,
        codexCliPath:
          provider === "codex" ? codexCliPath.trim() || null : undefined,
        allowDataSampling,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-config"] });
      queryClient.invalidateQueries({ queryKey: ["ai-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-models"] });
      onClose();
    },
  });

  const clear = useMutation({
    mutationFn: () => api.clearAiConfig(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-config"] });
      queryClient.invalidateQueries({ queryKey: ["ai-status"] });
      queryClient.invalidateQueries({ queryKey: ["ai-models"] });
      onClose();
    },
  });

  const test = useMutation({
    mutationFn: () =>
      api.testAiConfig({
        provider,
        // For openai: only send a key if the user typed a fresh one. Otherwise
        // the server falls back to the persisted key.
        apiKey:
          provider === "openai" && !keepExistingKey ? apiKey || null : undefined,
        baseUrl: baseUrl.trim() || null,
        model: model.trim() || null,
        copilotCliPath:
          provider === "copilot" ? copilotCliPath.trim() || null : undefined,
        claudeCliPath:
          provider === "claude-code" ? claudeCliPath.trim() || null : undefined,
        codexCliPath:
          provider === "codex" ? codexCliPath.trim() || null : undefined,
      }),
  });

  const detectCopilot = useMutation({
    mutationFn: () => api.detectCopilotCli(),
    onSuccess: (result) => {
      if (result.ok && result.path) setCopilotCliPath(result.path);
    },
  });

  const detectClaude = useMutation({
    mutationFn: () => api.detectClaudeCli(),
    onSuccess: (result) => {
      if (result.ok && result.path) setClaudeCliPath(result.path);
    },
  });

  const detectCodex = useMutation({
    mutationFn: () => api.detectCodexCli(),
    onSuccess: (result) => {
      if (result.ok && result.path) setCodexCliPath(result.path);
    },
  });

  const error =
    save.error instanceof ApiError
      ? save.error.message
      : save.error instanceof Error
        ? save.error.message
        : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[640px] max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <header className="mb-3 flex items-start gap-3">
          <div className="flex-1">
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              AI provider
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Used for natural-language queries. Stored encrypted at rest.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon btn-ghost"
          >
            <IconX size={16} />
          </button>
        </header>

        <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
          <Field label="Provider">
            <div className="seg w-full">
              <ProviderTab
                value="openai"
                current={provider}
                onClick={setProvider}
                label="API"
                icon={<IconWebhook size={14} />}
                title="Any OpenAI-compatible endpoint (OpenAI, Azure, GitHub Models, Ollama, …)"
              />
              <ProviderTab
                value="copilot"
                current={provider}
                onClick={setProvider}
                label="GitHub Copilot"
                icon={<GithubCopilotLogo size={14} />}
              />
              <ProviderTab
                value="claude-code"
                current={provider}
                onClick={setProvider}
                label="Claude Code"
                icon={<ClaudeLogo size={14} />}
              />
              <ProviderTab
                value="codex"
                current={provider}
                onClick={setProvider}
                label="Codex"
                icon={<OpenAiLogo size={14} />}
              />
            </div>
          </Field>

          {provider === "openai" && (
            <>
              <Field label="API key">
                {keepExistingKey && config.data?.apiKeySet ? (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-1 items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
                      <IconCheck size={12} className="text-emerald-500" />
                      Saved key in use
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setKeepExistingKey(false);
                        setApiKey("");
                      }}
                      className="btn btn-sm btn-outline"
                    >
                      Replace
                    </button>
                  </div>
                ) : (
                  <input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    type="password"
                    placeholder="sk-..."
                    spellCheck={false}
                    autoComplete="off"
                    className="field w-full font-mono"
                  />
                )}
              </Field>

              <Field label="Base URL (optional)">
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                  className="field w-full font-mono"
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Override for Azure OpenAI, GitHub Models, Ollama, etc.
                </div>
              </Field>
            </>
          )}

          {provider === "copilot" && (
            <>
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                Mango spawns your installed{" "}
                <span className="font-mono">copilot</span> CLI per request,
                using the existing login (or{" "}
                <span className="font-mono">GITHUB_TOKEN</span>).
              </div>

              <Field label="Copilot CLI path (optional)">
                <div className="flex gap-2">
                  <input
                    value={copilotCliPath}
                    onChange={(e) => setCopilotCliPath(e.target.value)}
                    placeholder="/Users/you/.npm-global/bin/copilot"
                    spellCheck={false}
                    className="field min-w-0 flex-1 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => detectCopilot.mutate()}
                    disabled={detectCopilot.isPending}
                    className="btn btn-sm btn-outline"
                    title="Detect Copilot CLI"
                  >
                    {detectCopilot.isPending ? (
                      <IconLoader2 size={12} className="animate-spin" />
                    ) : (
                      <IconSearch size={12} />
                    )}
                    Detect
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Uses server-side detection similar to where/command -v,
                  plus common install paths.
                </div>
                {detectCopilot.data?.ok && (
                  <div className="mt-1 break-words text-[11px] text-emerald-700 dark:text-emerald-300">
                    Found {detectCopilot.data.version ?? "Copilot CLI"} at{" "}
                    <span className="font-mono">{detectCopilot.data.path}</span>
                  </div>
                )}
                {detectCopilot.data && !detectCopilot.data.ok && (
                  <div className="mt-1 break-words text-[11px] text-red-600 dark:text-red-300">
                    {detectCopilot.data.error ?? "Copilot CLI not found."}
                  </div>
                )}
                {detectCopilot.error && !detectCopilot.data && (
                  <div className="mt-1 break-words text-[11px] text-red-600 dark:text-red-300">
                    {detectCopilot.error instanceof Error
                      ? detectCopilot.error.message
                      : String(detectCopilot.error)}
                  </div>
                )}
              </Field>
            </>
          )}

          {provider === "claude-code" && (
            <>
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                Mango spawns your installed{" "}
                <span className="font-mono">claude</span> CLI per request,
                using the existing login at{" "}
                <span className="font-mono">~/.claude</span> (or{" "}
                <span className="font-mono">ANTHROPIC_API_KEY</span>).
              </div>

              <Field label="Claude Code CLI path (optional)">
                <div className="flex gap-2">
                  <input
                    value={claudeCliPath}
                    onChange={(e) => setClaudeCliPath(e.target.value)}
                    placeholder="/Users/you/.claude/local/claude"
                    spellCheck={false}
                    className="field min-w-0 flex-1 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => detectClaude.mutate()}
                    disabled={detectClaude.isPending}
                    className="btn btn-sm btn-outline"
                    title="Detect Claude Code CLI"
                  >
                    {detectClaude.isPending ? (
                      <IconLoader2 size={12} className="animate-spin" />
                    ) : (
                      <IconSearch size={12} />
                    )}
                    Detect
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Uses server-side detection similar to where/command -v,
                  plus common install paths.
                </div>
                {detectClaude.data?.ok && (
                  <div className="mt-1 break-words text-[11px] text-emerald-700 dark:text-emerald-300">
                    Found {detectClaude.data.version ?? "Claude Code CLI"} at{" "}
                    <span className="font-mono">{detectClaude.data.path}</span>
                  </div>
                )}
                {detectClaude.data && !detectClaude.data.ok && (
                  <div className="mt-1 break-words text-[11px] text-red-600 dark:text-red-300">
                    {detectClaude.data.error ?? "Claude Code CLI not found."}
                  </div>
                )}
                {detectClaude.error && !detectClaude.data && (
                  <div className="mt-1 break-words text-[11px] text-red-600 dark:text-red-300">
                    {detectClaude.error instanceof Error
                      ? detectClaude.error.message
                      : String(detectClaude.error)}
                  </div>
                )}
              </Field>
            </>
          )}

          {provider === "codex" && (
            <>
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                Mango spawns your installed{" "}
                <span className="font-mono">codex</span> CLI per request,
                using the existing login at{" "}
                <span className="font-mono">~/.codex</span> (or{" "}
                <span className="font-mono">OPENAI_API_KEY</span>). Needs a
                current build — the one bundled with the ChatGPT app works.
              </div>

              <Field label="Codex CLI path (optional)">
                <div className="flex gap-2">
                  <input
                    value={codexCliPath}
                    onChange={(e) => setCodexCliPath(e.target.value)}
                    placeholder="/Users/you/.npm-global/bin/codex"
                    spellCheck={false}
                    className="field min-w-0 flex-1 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => detectCodex.mutate()}
                    disabled={detectCodex.isPending}
                    className="btn btn-sm btn-outline"
                    title="Detect Codex CLI"
                  >
                    {detectCodex.isPending ? (
                      <IconLoader2 size={12} className="animate-spin" />
                    ) : (
                      <IconSearch size={12} />
                    )}
                    Detect
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Uses server-side detection similar to where/command -v,
                  plus common install paths.
                </div>
                {detectCodex.data?.ok && (
                  <div className="mt-1 break-words text-[11px] text-emerald-700 dark:text-emerald-300">
                    Found {detectCodex.data.version ?? "Codex CLI"} at{" "}
                    <span className="font-mono">{detectCodex.data.path}</span>
                  </div>
                )}
                {detectCodex.data && !detectCodex.data.ok && (
                  <div className="mt-1 break-words text-[11px] text-red-600 dark:text-red-300">
                    {detectCodex.data.error ?? "Codex CLI not found."}
                  </div>
                )}
                {detectCodex.error && !detectCodex.data && (
                  <div className="mt-1 break-words text-[11px] text-red-600 dark:text-red-300">
                    {detectCodex.error instanceof Error
                      ? detectCodex.error.message
                      : String(detectCodex.error)}
                  </div>
                )}
              </Field>
            </>
          )}

          <Field label="Default model (optional)">
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={
                provider === "copilot"
                  ? "auto"
                  : provider === "claude-code"
                    ? "sonnet"
                    : provider === "codex"
                      ? "account default"
                      : "gpt-4o-mini"
              }
              spellCheck={false}
              className="field w-full font-mono"
            />
          </Field>

          <Field label="Data access">
            <label className="flex cursor-pointer items-start gap-2 rounded border border-slate-300 bg-white p-2 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900">
              <input
                type="checkbox"
                checked={allowDataSampling}
                onChange={(e) => setAllowDataSampling(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="font-medium">
                  Let AI sample collection values
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Runs <span className="font-mono">distinct()</span> on
                  low-cardinality string fields and includes the values in the
                  prompt. Improves filters for enum-like fields. Off by
                  default.
                </div>
              </div>
            </label>
          </Field>

          {error && (
            <div className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}

          {test.data && test.data.ok && (
            <div className="flex items-start gap-2 rounded border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-200">
              <IconCheck size={14} className="mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  Connected
                  {test.data.provider === "copilot" ||
                  test.data.provider === "claude-code" ||
                  test.data.provider === "codex"
                    ? ` — ${test.data.modelCount ?? 0} model suggestions loaded.`
                    : ` — ${test.data.modelCount ?? 0} model${test.data.modelCount === 1 ? "" : "s"} available.`}
                </div>
                {test.data.diagnostics?.cliVersion && (
                  <div className="mt-0.5 break-words font-mono text-[11px] opacity-80">
                    {String(test.data.diagnostics.cliVersion)}
                  </div>
                )}
                {test.data.diagnostics?.cliPath && (
                  <div className="mt-0.5 break-words font-mono text-[11px] opacity-70">
                    {String(test.data.diagnostics.cliPath)}
                  </div>
                )}
                {test.data.diagnostics?.modelSource && (
                  <div className="mt-0.5 text-[11px] opacity-70">
                    Models: {String(test.data.diagnostics.modelSource)}
                  </div>
                )}
                {test.data.sample && test.data.sample.length > 0 && (
                  <div className="mt-0.5 break-words font-mono text-[11px] opacity-80">
                    {test.data.sample.join(", ")}
                    {(test.data.modelCount ?? 0) > test.data.sample.length
                      ? ", …"
                      : ""}
                  </div>
                )}
              </div>
            </div>
          )}

          {test.data && !test.data.ok && (
            <div className="flex items-start gap-2 rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              <IconAlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Test failed</div>
                <div className="mt-0.5 break-words opacity-80">
                  {test.data.error ?? "Unknown error"}
                </div>
              </div>
            </div>
          )}

          {test.error && !test.data && (
            <div className="flex items-start gap-2 rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              <IconAlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">Test failed</div>
                <div className="mt-0.5 break-words opacity-80">
                  {test.error instanceof Error
                    ? test.error.message
                    : String(test.error)}
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="mt-5 flex flex-shrink-0 items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          {config.data?.persisted && (
            <button
              type="button"
              onClick={() => {
                if (confirm("Clear saved AI settings?")) clear.mutate();
              }}
              disabled={clear.isPending}
              className="btn btn-sm btn-outline border-red-300 text-red-700 hover:border-red-400 hover:bg-red-50 dark:border-red-700/50 dark:text-red-300 dark:hover:bg-red-900/20"
            >
              <IconTrash size={12} />
              Clear
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => test.mutate()}
            disabled={test.isPending}
            className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {test.isPending ? (
              <IconLoader2 size={12} className="animate-spin" />
            ) : (
              <IconPlugConnected size={12} />
            )}
            {test.isPending ? "Testing…" : "Test"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-outline"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="btn btn-primary"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
};

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div>
    <div className="mb-1 eyebrow">
      {label}
    </div>
    {children}
  </div>
);

const ProviderTab = ({
  value,
  current,
  onClick,
  label,
  icon,
  title,
}: {
  value: ProviderName;
  current: ProviderName;
  onClick: (v: ProviderName) => void;
  label: string;
  icon: React.ReactNode;
  title?: string;
}) => (
  <button
    type="button"
    onClick={() => onClick(value)}
    title={title}
    className="seg-item min-h-[26px] flex-1 justify-center"
    data-active={current === value}
  >
    {icon}
    {label}
  </button>
);
