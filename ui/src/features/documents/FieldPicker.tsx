import { IconCheck, IconSquare, IconSquareCheckFilled } from "@tabler/icons-react";
import { useMemo, useState } from "react";

interface Props {
  fields: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

/**
 * Field projection picker. When `selected` is empty, all fields are returned
 * (no projection applied). Otherwise only the picked fields are returned.
 */
export const FieldPicker = ({ fields, selected, onChange }: Props) => {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter((f) => f.toLowerCase().includes(q));
  }, [fields, search]);

  const toggle = (field: string) => {
    const next = new Set(selected);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    onChange(next);
  };

  const allSelected = selected.size === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1 dark:border-slate-800">
        <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Fields {selected.size > 0 && `· ${selected.size}`}
        </div>
        <button
          type="button"
          onClick={() => onChange(new Set())}
          disabled={allSelected}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
          title="Show all fields"
        >
          <IconCheck size={10} /> All
        </button>
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter fields…"
        className="border-b border-slate-200 bg-transparent px-2 py-1 text-[11px] text-slate-900 placeholder:text-slate-400 focus:outline-none dark:border-slate-800 dark:text-slate-100"
      />
      <ul className="flex-1 overflow-y-auto py-0.5">
        {fields.length === 0 && (
          <li className="px-2 py-1 text-[11px] text-slate-400">
            No schema sampled yet.
          </li>
        )}
        {fields.length > 0 && filtered.length === 0 && (
          <li className="px-2 py-1 text-[11px] text-slate-400">No matches.</li>
        )}
        {filtered.map((f) => {
          const checked = allSelected || selected.has(f);
          return (
            <li key={f}>
              <button
                type="button"
                onClick={() => toggle(f)}
                className="flex w-full items-center gap-1.5 px-2 py-[3px] text-left text-[12px] hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {checked ? (
                  <IconSquareCheckFilled
                    size={12}
                    className="flex-shrink-0 text-sky-500"
                  />
                ) : (
                  <IconSquare
                    size={12}
                    className="flex-shrink-0 text-slate-400"
                  />
                )}
                <span className="flex-1 truncate font-mono text-slate-700 dark:text-slate-200">
                  {f}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const buildProjectionJson = (selected: Set<string>): string => {
  if (selected.size === 0) return "";
  const out: Record<string, number> = {};
  for (const f of selected) out[f] = 1;
  return JSON.stringify(out);
};
