import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuEntry =
  | {
      kind?: "item";
      key: string;
      label: ReactNode;
      icon?: ReactNode;
      /** Right-aligned hint (count, shortcut). */
      hint?: ReactNode;
      active?: boolean;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { kind: "separator"; key: string }
  | { kind: "label"; key: string; label: ReactNode };

interface MenuProps {
  /** Viewport point the menu opens from (a click, or an anchor's corner). */
  at: { x: number; y: number };
  /** "end" right-aligns the menu to `at.x` (for buttons at the end of a row). */
  align?: "start" | "end";
  entries: MenuEntry[];
  onClose: () => void;
  /** Accessible name. */
  label: string;
  /** Cap for long lists (the tab switcher); the list scrolls inside. */
  maxHeight?: number;
  /** The button that toggles this menu — pointer-downs on it aren't "outside". */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

const GAP = 8;

/**
 * Lightweight popover menu rendered in a portal at a fixed viewport point —
 * used for right-click menus and overflow lists. Clamps itself inside the
 * viewport, supports ↑/↓/Home/End/Enter, and closes on Escape, outside
 * pointer-down, window blur/resize or any scroll outside the menu.
 */
export const Menu = ({
  at,
  align = "start",
  entries,
  onClose,
  label,
  maxHeight = 420,
  triggerRef,
}: MenuProps) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const items = entries.filter((e) => (e.kind ?? "item") === "item" && !("disabled" in e && e.disabled));
  const [focusKey, setFocusKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const rawLeft = align === "end" ? at.x - width : at.x;
    const left = Math.max(GAP, Math.min(rawLeft, window.innerWidth - width - GAP));
    const fitsBelow = at.y + height + GAP <= window.innerHeight;
    const top = fitsBelow ? at.y : Math.max(GAP, at.y - height);
    setPos({ left, top });
  }, [at.x, at.y, align, entries.length]);

  // Focus once placed: while `pos` is null the menu is visibility:hidden,
  // which can't take focus.
  const placed = pos !== null;
  useEffect(() => {
    if (placed) ref.current?.focus();
  }, [placed]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || triggerRef?.current?.contains(target)) return;
      onClose();
    };
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose, triggerRef]);

  useEffect(() => {
    if (!focusKey) return;
    ref.current
      ?.querySelector<HTMLElement>(`[data-menu-key="${CSS.escape(focusKey)}"]`)
      ?.focus();
  }, [focusKey]);

  const move = (delta: number | "first" | "last") => {
    if (items.length === 0) return;
    const current = items.findIndex((i) => i.key === focusKey);
    const next =
      delta === "first"
        ? 0
        : delta === "last"
          ? items.length - 1
          : (current + delta + items.length) % items.length;
    setFocusKey(items[next]?.key ?? null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(focusKey ? 1 : "first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(focusKey ? -1 : "last");
    } else if (e.key === "Home") {
      e.preventDefault();
      move("first");
    } else if (e.key === "End") {
      e.preventDefault();
      move("last");
    } else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        left: pos?.left ?? at.x,
        top: pos?.top ?? at.y,
        maxHeight,
        visibility: pos ? "visible" : "hidden",
      }}
      className="fixed z-50 min-w-[180px] max-w-[360px] overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-[12px] shadow-lg outline-none dark:border-slate-700 dark:bg-slate-900"
    >
      {entries.map((entry) => {
        if (entry.kind === "separator") {
          return <div key={entry.key} role="separator" className="my-1 h-px bg-slate-200 dark:bg-slate-800" />;
        }
        if (entry.kind === "label") {
          return (
            <div key={entry.key} className="eyebrow px-3 pb-1 pt-1.5">
              {entry.label}
            </div>
          );
        }
        return (
          <button
            key={entry.key}
            type="button"
            role="menuitem"
            data-menu-key={entry.key}
            disabled={entry.disabled}
            aria-current={entry.active || undefined}
            onMouseEnter={() => setFocusKey(entry.key)}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
            className={[
              "flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none disabled:opacity-50",
              "focus:bg-slate-100 dark:focus:bg-slate-800",
              entry.danger
                ? "text-red-700 dark:text-red-300"
                : entry.active
                  ? "font-medium text-slate-900 dark:text-slate-100"
                  : "text-slate-700 dark:text-slate-200",
            ].join(" ")}
          >
            {entry.icon && <span className="flex w-4 flex-shrink-0 justify-center">{entry.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.hint && <span className="flex-shrink-0 text-[11px] text-slate-500">{entry.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
};
