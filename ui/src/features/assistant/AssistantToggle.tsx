import { IconSparkles } from "@tabler/icons-react";
import { useAssistant } from "./AssistantContext";

export const AssistantToggle = () => {
  const { open, setOpen } = useAssistant();
  if (open) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="absolute right-3 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 shadow-sm transition hover:border-violet-400 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-violet-500/40 dark:hover:text-violet-200"
      title="Open assistant (⌘/Ctrl + I)"
      aria-label="Open assistant"
    >
      <IconSparkles size={15} />
    </button>
  );
};
