import { useQuery } from "@tanstack/react-query";
import {
  IconChevronDown,
  IconChevronLeft,
  IconDatabase,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTable,
  IconTerminal,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { SettingsMenu } from "../../components/SettingsMenu";
import { useResize } from "../../components/useResize";
import { ConnectionPicker } from "../connections/ConnectionPicker";
import { useActiveConnection } from "../connections/useActiveConnection";
import { useActiveDatabase } from "../connections/useActiveDatabase";
import { useTabs } from "../tabs/TabsContext";

export const Sidebar = () => {
  const docsUrl =
    import.meta.env.VITE_MANGO_DOCS_URL ?? "https://philbir.github.io/mango/";
  const version = import.meta.env.VITE_MANGO_VERSION ?? "v0.1.0";
  const { activeId } = useActiveConnection();
  const { database, setDatabase } = useActiveDatabase();
  const { activeTab, openCollection, openConsole, openShell } = useTabs();
  const { size: sidebarWidth, onMouseDown: onResizeStart } = useResize({
    storageKey: "mango:sidebar-width",
    axis: "x",
    initial: 256,
    min: 200,
    max: 520,
  });

  const databasesQuery = useQuery({
    queryKey: ["databases", activeId],
    queryFn: () => api.listDatabases(activeId!),
    enabled: !!activeId && !database,
  });

  const collectionsQuery = useQuery({
    queryKey: ["collections", activeId, database],
    queryFn: () => api.listCollections(activeId!, database ?? undefined),
    enabled: !!activeId && !!database,
  });

  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!collectionsQuery.data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return collectionsQuery.data.collections;
    return collectionsQuery.data.collections.filter((c) =>
      c.name.toLowerCase().includes(q),
    );
  }, [collectionsQuery.data, search]);

  const onRefresh = () => {
    if (database) collectionsQuery.refetch();
    else databasesQuery.refetch();
  };

  const isFetching = database
    ? collectionsQuery.isFetching
    : databasesQuery.isFetching;

  return (
    <aside
      className="relative flex h-full flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60"
      style={{ width: sidebarWidth }}
    >
      <div className="flex items-center gap-1.5 border-b border-slate-200 px-2 py-2 dark:border-slate-800">
        <div className="flex-1">
          <ConnectionPicker />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={!activeId}
          className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          title="Refresh"
        >
          <IconRefresh
            size={14}
            className={isFetching ? "animate-spin" : ""}
          />
        </button>
        <SettingsMenu />
      </div>

      {activeId && database && (
        <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setDatabase(null)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title="Switch database"
          >
            <IconChevronLeft size={12} />
          </button>
          <IconDatabase size={11} className="text-slate-400" />
          <span className="flex-1 truncate font-mono text-[11px] text-slate-700 dark:text-slate-200">
            {database}
          </span>
          <NewMenu onNewConsole={openConsole} onNewShell={openShell} />
        </div>
      )}

      {activeId && database && (
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

        {activeId && !database && (
          <DatabaseList
            data={databasesQuery.data}
            isLoading={databasesQuery.isLoading}
            isError={databasesQuery.isError}
            error={databasesQuery.error as Error | null}
            onPick={setDatabase}
          />
        )}

        {activeId && database && (
          <>
            {collectionsQuery.isLoading && (
              <div className="px-2 py-1.5 text-xs text-slate-400">Loading…</div>
            )}
            {collectionsQuery.isError && (
              <div className="px-2 py-1.5 text-xs text-red-500 dark:text-red-400">
                {(collectionsQuery.error as Error).message}
              </div>
            )}
            {collectionsQuery.data && filtered.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-slate-400">
                {search ? "No matches." : "No collections."}
              </div>
            )}
            <ul>
              {filtered.map((c) => {
                const isActive =
                  activeTab?.kind === "collection" &&
                  activeTab.collection === c.name;
                return (
                  <li key={c.name}>
                    <button
                      type="button"
                      onClick={() => openCollection(c.name)}
                      className={[
                        "flex w-full items-center gap-1.5 rounded px-2 py-[3px] text-left text-[12.5px] leading-tight",
                        isActive
                          ? "bg-sky-500/15 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
                          : "text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800",
                      ].join(" ")}
                    >
                      <IconTable size={12} className="text-slate-400" />
                      <span className="flex-1 truncate font-mono">{c.name}</span>
                      <span className="text-[10.5px] text-slate-400 dark:text-slate-500">
                        {c.count?.toLocaleString() ?? "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <a
        href={docsUrl}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 border-t border-slate-200 px-3 py-1.5 text-[10px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:border-slate-800 dark:text-slate-500 dark:hover:bg-slate-800/70 dark:hover:text-slate-300"
        title="Open Mango docs"
      >
        <img
          src="/assets/mango-mark.svg"
          alt=""
          className="h-4 w-4 shrink-0 dark:hidden"
          draggable={false}
        />
        <img
          src="/assets/mango-mark-dark.svg"
          alt=""
          className="hidden h-4 w-4 shrink-0 dark:block"
          draggable={false}
        />
        <span>Mango · {version}</span>
      </a>
      <div
        onMouseDown={onResizeStart}
        className="absolute -right-0.5 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-sky-500/40"
        title="Drag to resize"
      />
    </aside>
  );
};

interface NewMenuProps {
  onNewConsole: () => void;
  onNewShell: () => void;
}

const NewMenu = ({ onNewConsole, onNewShell }: NewMenuProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative flex items-stretch" ref={ref}>
      <button
        type="button"
        onClick={onNewConsole}
        className="flex items-center gap-0.5 rounded-l px-1 py-0.5 text-[10.5px] font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        title="New console"
      >
        <IconPlus size={10} />
        New
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-r border-l border-slate-300/60 px-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:border-slate-700/80 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        title="New…"
      >
        <IconChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-36 rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNewConsole();
            }}
            className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <IconTerminal2 size={12} className="text-slate-400" />
            New console
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNewShell();
            }}
            className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <IconTerminal size={12} className="text-slate-400" />
            New shell
          </button>
        </div>
      )}
    </div>
  );
};

interface DatabaseListProps {
  data:
    | {
        databases: Array<{
          name: string;
          sizeOnDisk: number | null;
          empty: boolean;
        }>;
      }
    | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onPick: (name: string) => void;
}

const DatabaseList = ({
  data,
  isLoading,
  isError,
  error,
  onPick,
}: DatabaseListProps) => {
  if (isLoading) {
    return <div className="px-2 py-1.5 text-xs text-slate-400">Loading…</div>;
  }
  if (isError) {
    return (
      <div className="px-2 py-1.5 text-xs text-red-500 dark:text-red-400">
        {error?.message ?? "Failed to list databases."}
      </div>
    );
  }
  const databases = data?.databases ?? [];
  if (databases.length === 0) {
    return (
      <div className="px-2 py-1.5 text-xs text-slate-400">No databases.</div>
    );
  }
  return (
    <>
      <div className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Databases
      </div>
      <ul>
        {databases.map((d) => (
          <li key={d.name}>
            <button
              type="button"
              onClick={() => onPick(d.name)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-[3px] text-left text-[12.5px] leading-tight text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <IconDatabase size={12} className="text-slate-400" />
              <span className="flex-1 truncate font-mono">{d.name}</span>
              {d.sizeOnDisk != null && (
                <span className="text-[10.5px] text-slate-400 dark:text-slate-500">
                  {formatBytes(d.sizeOnDisk)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
};

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)}K`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}M`;
  return `${(n / 1024 ** 3).toFixed(2)}G`;
};
