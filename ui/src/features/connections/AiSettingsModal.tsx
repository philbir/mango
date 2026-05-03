import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconCheck,
  IconLoader2,
  IconPlugConnected,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { type AiProviderId, ApiError, api } from "../../api/client";

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
  const [allowDataSampling, setAllowDataSampling] = useState(false);

  useEffect(() => {
    if (!config.data) return;
    setProvider(config.data.provider ?? "openai");
    setBaseUrl(config.data.baseUrl ?? "");
    setModel(config.data.model ?? "");
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
      }),
  });

  const error =
    save.error instanceof ApiError
      ? save.error.message
      : save.error instanceof Error
        ? save.error.message
        : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[640px] max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
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
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <IconX size={16} />
          </button>
        </header>

        <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
          <Field label="Provider">
            <div className="flex rounded border border-slate-300 bg-white p-0.5 text-xs dark:border-slate-700 dark:bg-slate-950">
              <ProviderTab
                value="openai"
                current={provider}
                onClick={setProvider}
                label="OpenAI-compatible"
              />
              <ProviderTab
                value="copilot"
                current={provider}
                onClick={setProvider}
                label="GitHub Copilot"
              />
              <ProviderTab
                value="claude-code"
                current={provider}
                onClick={setProvider}
                label="Claude Code"
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
                      className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
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
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                )}
              </Field>

              <Field label="Base URL (optional)">
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <div className="mt-1 text-[10px] text-slate-500">
                  Override for Azure OpenAI, GitHub Models, Ollama, etc.
                </div>
              </Field>
            </>
          )}

          {provider === "copilot" && (
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              Copilot uses your <span className="font-mono">GITHUB_TOKEN</span>{" "}
              env var or the existing Copilot CLI session — no key entry here.
            </div>
          )}

          {provider === "claude-code" && (
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              Claude Code uses your{" "}
              <span className="font-mono">ANTHROPIC_API_KEY</span> env var, or
              the existing Claude Code CLI login (creds at{" "}
              <span className="font-mono">~/.claude</span>) — no key entry here.
            </div>
          )}

          <Field label="Default model (optional)">
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={
                provider === "copilot"
                  ? "claude-sonnet-4.5"
                  : provider === "claude-code"
                    ? "sonnet"
                    : "gpt-4o-mini"
              }
              spellCheck={false}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
                  Connected — {test.data.modelCount ?? 0} model
                  {test.data.modelCount === 1 ? "" : "s"} available.
                </div>
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
              className="flex items-center gap-1 rounded border border-red-300 px-2 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-700/40 dark:text-red-300 dark:hover:bg-red-900/20"
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
            className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
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
    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
}: {
  value: ProviderName;
  current: ProviderName;
  onClick: (v: ProviderName) => void;
  label: string;
}) => (
  <button
    type="button"
    onClick={() => onClick(value)}
    className={[
      "flex-1 rounded px-2 py-1 text-center",
      current === value
        ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
        : "text-slate-600 dark:text-slate-300",
    ].join(" ")}
  >
    {label}
  </button>
);
