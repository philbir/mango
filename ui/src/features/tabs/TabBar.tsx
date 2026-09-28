import {
  IconChevronLeft,
  IconChevronRight,
  IconDatabase,
  IconDotsVertical,
  IconFiles,
  IconNotebook,
  IconTable,
  IconTerminal,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Menu, type MenuEntry } from "../../components/Menu";
import { useAssistant } from "../assistant/AssistantContext";
import { mangoFileDisplayName } from "../workspaces/markdownDoc";
import { type Tab, useTabs } from "./TabsContext";

const labelFor = (tab: Tab, index: number): string => {
  if (tab.kind === "collection") return tab.collection ?? "(collection)";
  if (tab.kind === "console") return `console ${index}`;
  if (tab.kind === "notebook") {
    const base = (tab.workspaceFilePath ?? "").split("/").pop() ?? "(file)";
    return mangoFileDisplayName(base);
  }
  if (tab.kind === "database") return tab.database ?? "(database)";
  if (tab.kind === "gridfs") return tab.bucket ? `${tab.bucket} files` : "(gridfs)";
  return `shell ${index}`;
};

const iconFor = (tab: Tab) =>
  tab.kind === "shell" ? (
    <IconTerminal size={13} className="text-slate-500" />
  ) : tab.kind === "console" ? (
    <IconTerminal2 size={13} className="text-slate-500" />
  ) : tab.kind === "notebook" ? (
    <IconNotebook size={13} className="text-violet-500" />
  ) : tab.kind === "database" ? (
    <IconDatabase size={13} className="text-amber-500" />
  ) : tab.kind === "gridfs" ? (
    <IconFiles size={13} className="text-emerald-500" />
  ) : (
    <IconTable size={13} className="text-sky-500" />
  );

type OpenMenu =
  | { kind: "tab"; tabId: string; x: number; y: number }
  | { kind: "list"; x: number; y: number };

/**
 * Tab strip. Overflow scrolls horizontally without a visible scrollbar —
 * mouse wheel, arrow buttons that appear only when tabs are hidden on that
 * side, and the active tab is kept in view. The ⋮ menu at the end lists every
 * open tab (switch / close all); right-click a tab for Close, Close others,
 * Close all.
 */
export const TabBar = () => {
  const { tabs, activeId, activate, closeTab, closeOthers, closeAll } = useTabs();
  // The closed-assistant toggle floats over the top-right corner
  // (AssistantToggle, absolute right-2); keep the ⋮ button clear of it.
  const { open: assistantOpen } = useAssistant();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const listButtonRef = useRef<HTMLButtonElement | null>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, tabs.length]);

  // Vertical wheel → horizontal scroll. Needs a non-passive listener to
  // preventDefault; React's onWheel is passive.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // trackpad: native
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [tabs.length > 0]);

  // Keep the active tab visible (switching from the ⋮ list, opening a tab
  // from the sidebar).
  useEffect(() => {
    if (!activeId) return;
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  if (tabs.length === 0) return null;

  const consoleIndices: Record<string, number> = {};
  const shellIndices: Record<string, number> = {};
  let consoleN = 0;
  let shellN = 0;
  for (const t of tabs) {
    if (t.kind === "console") consoleIndices[t.id] = ++consoleN;
    else if (t.kind === "shell") shellIndices[t.id] = ++shellN;
  }
  const indexOf = (tab: Tab) =>
    tab.kind === "console"
      ? consoleIndices[tab.id] ?? 0
      : tab.kind === "shell"
        ? shellIndices[tab.id] ?? 0
        : 0;

  const scrollBy = (direction: -1 | 1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const menuEntries = (): MenuEntry[] => {
    if (!menu) return [];
    if (menu.kind === "tab") {
      const id = menu.tabId;
      return [
        { key: "close", label: "Close", onSelect: () => closeTab(id) },
        {
          key: "close-others",
          label: "Close others",
          disabled: tabs.length < 2,
          onSelect: () => closeOthers(id),
        },
        { key: "close-all", label: "Close all", onSelect: closeAll },
      ];
    }
    return [
      {
        key: "close-all",
        label: "Close all tabs",
        icon: <IconX size={13} />,
        hint: tabs.length,
        danger: true,
        onSelect: closeAll,
      },
      { kind: "separator", key: "sep" },
      { kind: "label", key: "open", label: `Open tabs · ${tabs.length}` },
      ...tabs.map<MenuEntry>((tab) => ({
        key: tab.id,
        label: <span className="font-mono">{labelFor(tab, indexOf(tab))}</span>,
        icon: iconFor(tab),
        active: tab.id === activeId,
        hint: tab.id === activeId ? "active" : undefined,
        onSelect: () => activate(tab.id),
      })),
    ];
  };

  const edgeButton =
    "flex h-full w-6 flex-shrink-0 items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100";

  return (
    <div className="flex h-10 flex-shrink-0 items-stretch border-b border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900/60">
      {overflow.left && (
        <button type="button" className={edgeButton} onClick={() => scrollBy(-1)} title="Scroll tabs left" aria-label="Scroll tabs left">
          <IconChevronLeft size={14} />
        </button>
      )}
      <div
        ref={stripRef}
        onScroll={measure}
        role="tablist"
        aria-label="Open tabs"
        className="no-scrollbar flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden px-2"
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const label = labelFor(tab, indexOf(tab));
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ kind: "tab", tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
              className={[
                "group -mb-px flex h-[33px] flex-shrink-0 items-center gap-1 rounded-t border border-b-0 pl-2 pr-1 text-[12px]",
                active
                  ? "border-slate-300 bg-white text-slate-900 shadow-[inset_0_2px_0_var(--color-sky-500)] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  : "border-transparent text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100",
              ].join(" ")}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => activate(tab.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) closeTab(tab.id);
                }}
                className="flex h-full items-center gap-1.5"
                title={label}
              >
                {iconFor(tab)}
                <span className="max-w-[180px] truncate font-mono">{label}</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={[
                  "btn-icon min-h-[20px] min-w-[20px] text-slate-500 hover:bg-slate-300 hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-slate-100",
                  active ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
                ].join(" ")}
                title="Close tab"
              >
                <IconX size={13} />
              </button>
            </div>
          );
        })}
      </div>
      {overflow.right && (
        <button type="button" className={edgeButton} onClick={() => scrollBy(1)} title="Scroll tabs right" aria-label="Scroll tabs right">
          <IconChevronRight size={14} />
        </button>
      )}
      <button
        ref={listButtonRef}
        type="button"
        className={`${edgeButton} w-8 border-l border-slate-200 dark:border-slate-800`}
        aria-haspopup="menu"
        aria-expanded={menu?.kind === "list"}
        title="All open tabs"
        aria-label="All open tabs"
        onClick={(e) => {
          if (menu?.kind === "list") return setMenu(null);
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu({ kind: "list", x: rect.right - 4, y: rect.bottom + 2 });
        }}
      >
        <IconDotsVertical size={15} />
      </button>
      {!assistantOpen && <div className="w-10 flex-shrink-0" aria-hidden />}
      {menu && (
        <Menu
          at={{ x: menu.x, y: menu.y }}
          align={menu.kind === "list" ? "end" : "start"}
          label={menu.kind === "list" ? "All open tabs" : "Tab actions"}
          entries={menuEntries()}
          onClose={closeMenu}
          triggerRef={menu.kind === "list" ? listButtonRef : undefined}
        />
      )}
    </div>
  );
};
