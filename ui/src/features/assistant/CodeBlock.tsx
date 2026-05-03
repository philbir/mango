import {
  IconCheck,
  IconCopy,
  IconPlayerPlayFilled,
  IconWand,
} from "@tabler/icons-react";
import { useState } from "react";
import { type ApplyKind, useAssistant } from "./AssistantContext";

interface Props {
  lang: string;
  code: string;
}

const langToKind = (lang: string): ApplyKind | null => {
  const l = lang.toLowerCase();
  if (l === "mango-filter") return "filter";
  if (l === "mango-projection") return "projection";
  if (l === "mango-sort") return "sort";
  if (l === "mango-pipeline") return "pipeline";
  if (l === "mango-shell") return "shell";
  if (l === "mango-console") return "console";
  return null;
};

const labelFor = (kind: ApplyKind): string => {
  switch (kind) {
    case "filter":
      return "Apply filter";
    case "projection":
      return "Apply projection";
    case "sort":
      return "Apply sort";
    case "pipeline":
      return "Use pipeline";
    case "shell":
      return "Send to shell";
    case "console":
      return "Send to console";
  }
};

const langLabel = (lang: string): string => {
  if (!lang) return "code";
  const map: Record<string, string> = {
    "mango-filter": "filter · json",
    "mango-projection": "projection · json",
    "mango-sort": "sort · json",
    "mango-pipeline": "pipeline · json",
    "mango-shell": "shell · runCommand",
    "mango-console": "console · js",
    js: "javascript",
    javascript: "javascript",
  };
  return map[lang] ?? lang;
};

export const CodeBlock = ({ lang, code }: Props) => {
  const { applyArtifact, supports } = useAssistant();
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);

  const kind = langToKind(lang);
  const canApply = !!kind && supports(kind);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const onApply = () => {
    if (!kind) return;
    const ok = applyArtifact(kind, code);
    if (ok) {
      setApplied(true);
      setTimeout(() => setApplied(false), 1500);
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
        <span className="font-mono normal-case">{langLabel(lang)}</span>
        <div className="flex items-center gap-1">
          {canApply && kind && (
            <button
              type="button"
              onClick={onApply}
              className={[
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium normal-case",
                applied
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : kind === "shell" || kind === "console"
                    ? "bg-sky-500/15 text-sky-700 hover:bg-sky-500/25 dark:bg-sky-500/20 dark:text-sky-200"
                    : "bg-violet-500/15 text-violet-700 hover:bg-violet-500/25 dark:bg-violet-500/20 dark:text-violet-200",
              ].join(" ")}
            >
              {applied ? (
                <>
                  <IconCheck size={11} />
                  Applied
                </>
              ) : kind === "shell" || kind === "console" ? (
                <>
                  <IconPlayerPlayFilled size={11} />
                  {labelFor(kind)}
                </>
              ) : (
                <>
                  <IconWand size={11} />
                  {labelFor(kind)}
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100 normal-case"
          >
            {copied ? (
              <>
                <IconCheck size={11} />
                Copied
              </>
            ) : (
              <>
                <IconCopy size={11} />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-2 font-mono text-[12px] leading-snug text-slate-800 dark:text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
};
