import {
  IconChevronDown,
  IconCircleDot,
  IconPlus,
  IconSettings,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { type ConnectionPublic } from "../../api/client";
import { useActiveConnection } from "./useActiveConnection";
import { ConnectionFormModal } from "./ConnectionFormModal";

export const ConnectionPicker = () => {
  const { active, connections, setActiveId } = useActiveConnection();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<
    { mode: "create" } | { mode: "edit"; conn: ConnectionPublic } | null
  >(null);
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
    <>
      <div className="relative w-full" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-left hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <span
            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ background: active?.color ?? "#94a3b8" }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-slate-900 dark:text-slate-100">
              {active?.name ?? "No connection"}
            </div>
            <div className="truncate font-mono text-[10px] text-slate-500 dark:text-slate-500">
              {active?.uriRedacted ?? "Add one to get started"}
            </div>
          </div>
          <IconChevronDown size={14} className="text-slate-400" />
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <ul className="max-h-64 overflow-y-auto py-1">
              {connections.length === 0 && (
                <li className="px-3 py-2 text-xs text-slate-500">
                  No connections yet.
                </li>
              )}
              {connections.map((c) => (
                <li
                  key={c.id}
                  className={`group flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-slate-100 dark:hover:bg-slate-800 ${
                    active?.id === c.id ? "bg-sky-500/10 dark:bg-sky-500/15" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="flex flex-1 items-center gap-2 text-left"
                    onClick={() => {
                      setActiveId(c.id);
                      setOpen(false);
                    }}
                  >
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ background: c.color ?? "#94a3b8" }}
                    />
                    <span className="flex-1 truncate text-slate-900 dark:text-slate-100">
                      {c.name}
                    </span>
                    {active?.id === c.id && (
                      <IconCircleDot size={12} className="text-sky-500" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 opacity-0 hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                    title="Edit"
                    onClick={() => {
                      setOpen(false);
                      setModal({ mode: "edit", conn: c });
                    }}
                  >
                    <IconSettings size={12} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-slate-200 p-1 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setModal({ mode: "create" });
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/15"
              >
                <IconPlus size={14} />
                New connection
              </button>
            </div>
          </div>
        )}
      </div>

      {modal && (
        <ConnectionFormModal
          mode={modal.mode}
          existing={modal.mode === "edit" ? modal.conn : undefined}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
};
