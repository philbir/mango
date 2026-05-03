import {
  IconChevronDown,
  IconCircleDot,
  IconList,
  IconPlus,
  IconSettings,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { type ConnectionPublic } from "../../api/client";
import { useActiveConnection } from "./useActiveConnection";
import { useServerConfig } from "./useServerConfig";
import { ConnectionFormModal } from "./ConnectionFormModal";
import { ConnectionsManagerModal } from "./ConnectionsManagerModal";

export const ConnectionPicker = () => {
  const { active, connections, setActiveId } = useActiveConnection();
  const { mode } = useServerConfig();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; conn: ConnectionPublic }
    | { mode: "manage" }
    | null
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

  if (mode === "standalone") {
    return (
      <div className="flex w-full items-center gap-2 px-1 py-1.5">
        <IconCircleDot size={14} className="flex-shrink-0 text-emerald-500" />
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900 dark:text-slate-100">
          {active?.name ?? "Connecting…"}
        </div>
        {active && <SourceBadge conn={active} />}
      </div>
    );
  }

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
          </div>
          {active && <SourceBadge conn={active} />}
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
                    <SourceBadge conn={c} />
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
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setModal({ mode: "manage" });
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <IconList size={14} />
                Manage
              </button>
            </div>
          </div>
        )}
      </div>

      {modal?.mode === "manage" && (
        <ConnectionsManagerModal onClose={() => setModal(null)} />
      )}

      {(modal?.mode === "create" || modal?.mode === "edit") && (
        <ConnectionFormModal
          mode={modal.mode}
          existing={modal.mode === "edit" ? modal.conn : undefined}
          onClose={() => setModal(null)}
          onCreated={(c) => setActiveId(c.id)}
        />
      )}
    </>
  );
};

type BadgeKind = "aspire" | "atlas" | "docker" | null;

const detectKind = (conn: ConnectionPublic): BadgeKind => {
  if (conn.aspire) return "aspire";
  if (conn.source === "docker") return "docker";
  // Atlas stays inferred from the URI — there's no explicit "Add from Atlas"
  // discovery flow, but mongodb+srv://*.mongodb.net is unambiguous.
  const uri = conn.uriRedacted ?? "";
  if (/^mongodb\+srv:\/\//i.test(uri) || /\.mongodb\.net(?:[:/?]|$)/i.test(uri)) {
    return "atlas";
  }
  return null;
};

const sourceTitle = (conn: ConnectionPublic, kind: BadgeKind): string => {
  if (kind === "aspire" && conn.aspire) {
    return `Aspire-linked: ${conn.aspire.resourceName} in ${conn.aspire.appHostPath}`;
  }
  if (kind === "atlas") return "MongoDB Atlas / SRV";
  if (kind === "docker") return "Docker container";
  return "";
};

const KIND_ICON: Record<Exclude<BadgeKind, null>, { src: string; alt: string }> = {
  aspire: { src: "/assets/aspire-logo.svg", alt: "Aspire" },
  atlas: { src: "/assets/mongodb-logo.svg", alt: "MongoDB Atlas" },
  docker: { src: "/assets/docker-logo.svg", alt: "Docker" },
};

export const SourceBadge = ({ conn }: { conn: ConnectionPublic }) => {
  const kind = detectKind(conn);
  if (!kind) return null;
  const icon = KIND_ICON[kind];
  return (
    <img
      src={icon.src}
      alt={icon.alt}
      title={sourceTitle(conn, kind)}
      draggable={false}
      className="h-3.5 w-3.5 flex-shrink-0"
    />
  );
};

