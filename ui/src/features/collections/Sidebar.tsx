import { useQuery } from "@tanstack/react-query";
import {
  IconRefresh,
  IconSearch,
  IconTable,
  IconTerminal2,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../../api/client";
import { SettingsMenu } from "../../components/SettingsMenu";
import { ConnectionPicker } from "../connections/ConnectionPicker";
import { useActiveConnection } from "../connections/useActiveConnection";

export const Sidebar = () => {
  const { activeId } = useActiveConnection();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["collections", activeId],
    queryFn: () => api.listCollections(activeId!),
    enabled: !!activeId,
  });

  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.collections;
    return data.collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [data, search]);

  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center gap-1.5 border-b border-slate-200 px-2 py-2 dark:border-slate-800">
        <div className="flex-1">
          <ConnectionPicker />
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={!activeId}
          className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          title="Refresh collections"
        >
          <IconRefresh
            size={14}
            className={isFetching ? "animate-spin" : ""}
          />
        </button>
        <SettingsMenu />
      </div>

      {data?.database && (
        <div className="border-b border-slate-200 px-3 py-1 text-[10px] uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
          db <span className="font-mono normal-case">{data.database}</span>
        </div>
      )}

      <div className="border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
        <NavLink
          to="/shell"
          className={({ isActive }) =>
            [
              "flex items-center gap-2 rounded px-2 py-1 text-[13px]",
              isActive
                ? "bg-sky-500/15 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300"
                : "text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800",
            ].join(" ")
          }
        >
          <IconTerminal2 size={14} />
          <span className="font-mono">Shell</span>
        </NavLink>
      </div>

      {activeId && (
        <div className="border-b border-slate-200 px-2 py-1.5 dark:border-slate-800">
          <div className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950">
            <IconSearch size={12} className="text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter collections…"
              className="flex-1 bg-transparent text-[12px] text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-1 py-1">
        {!activeId && (
          <div className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400">
            Add a connection to get started.
          </div>
        )}
        {activeId && isLoading && (
          <div className="px-2 py-1.5 text-xs text-slate-400">Loading…</div>
        )}
        {activeId && isError && (
          <div className="px-2 py-1.5 text-xs text-red-500 dark:text-red-400">
            {(error as Error).message}
          </div>
        )}
        {activeId && data && filtered.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-slate-400">
            {search ? "No matches." : "No collections."}
          </div>
        )}
        <ul>
          {filtered.map((c) => (
            <li key={c.name}>
              <NavLink
                to={`/c/${encodeURIComponent(c.name)}`}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-1.5 rounded px-2 py-[3px] text-[12.5px] leading-tight",
                    isActive
                      ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
                      : "text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800",
                  ].join(" ")
                }
              >
                <IconTable size={12} className="text-slate-400" />
                <span className="flex-1 truncate font-mono">{c.name}</span>
                <span className="text-[10.5px] text-slate-400 dark:text-slate-500">
                  {c.count?.toLocaleString() ?? "—"}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-slate-200 px-3 py-1.5 text-[10px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
        Mango · v0.1
      </div>
    </aside>
  );
};
