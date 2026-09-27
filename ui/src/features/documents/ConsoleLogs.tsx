import { EJSON } from "bson";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import type { ConsoleLogEntry } from "../../api/client";

const formatArg = (arg: unknown): string => {
  if (typeof arg === "string") return arg;
  try {
    return EJSON.stringify(arg as never, { relaxed: true });
  } catch {
    return String(arg);
  }
};

const LEVEL_CLASS: Record<ConsoleLogEntry["level"], string> = {
  log: "text-slate-700 dark:text-slate-300",
  info: "text-sky-700 dark:text-sky-300",
  warn: "text-amber-700 dark:text-amber-300",
  error: "text-red-700 dark:text-red-300",
};

/** Collapsible strip showing `print(...)` / `console.*` output of a script run. */
export const ConsoleLogs = ({ logs }: { logs: ConsoleLogEntry[] }) => {
  const [open, setOpen] = useState(true);
  if (logs.length === 0) return null;
  return (
    <div className="flex-shrink-0 border-b border-slate-200 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-full items-center gap-1 px-4 text-[11.5px] font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900/40"
      >
        {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
        Output
        <span className="text-slate-400 dark:text-slate-500">({logs.length})</span>
      </button>
      {open && (
        <pre className="max-h-40 overflow-auto px-4 pb-2 font-mono text-[12px] leading-5">
          {logs.map((l, i) => (
            <div key={i} className={LEVEL_CLASS[l.level]}>
              {l.args.map(formatArg).join(" ")}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
};
