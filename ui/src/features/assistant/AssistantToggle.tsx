import { IconSparkles } from "@tabler/icons-react";
import { useAssistant } from "./AssistantContext";

export const AssistantToggle = () => {
  const { open, setOpen } = useAssistant();
  if (open) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="absolute right-2 top-[6px] z-20 flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-violet-600 shadow-sm transition hover:border-violet-400 hover:bg-violet-50 dark:border-slate-700 dark:bg-slate-900 dark:text-violet-300 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10"
      title="Open assistant (⌘/Ctrl + I)"
      aria-label="Open assistant"
    >
      <IconSparkles size={15} />
    </button>
  );
};
