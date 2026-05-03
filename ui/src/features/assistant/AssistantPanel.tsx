import { IconSparkles, IconX } from "@tabler/icons-react";
import { useCallback, useRef } from "react";
import { useAssistant } from "./AssistantContext";
import { ChatBox } from "./ChatBox";

export const AssistantPanel = () => {
  const { open, setOpen, width, setWidth } = useAssistant();
  const dragRef = useRef<{ start: number; base: number } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { start: e.clientX, base: width };
      const move = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        // Drag left = grow (handle is on the left edge).
        const delta = dragRef.current.start - ev.clientX;
        setWidth(dragRef.current.base + delta);
      };
      const up = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [setWidth, width],
  );

  if (!open) return null;

  return (
    <aside
      className="relative flex h-full flex-shrink-0 flex-col border-l border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60"
      style={{ width }}
    >
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <IconSparkles size={14} className="text-violet-500 dark:text-violet-300" />
        <div className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
          Assistant
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          title="Close (⌘/Ctrl + I)"
        >
          <IconX size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1">
        <ChatBox />
      </div>

      <div
        onMouseDown={onMouseDown}
        className="absolute -left-0.5 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-violet-500/40"
        title="Drag to resize"
      />
    </aside>
  );
};
