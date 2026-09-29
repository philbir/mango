import { IconLoader2, IconPlayerPlayFilled } from "@tabler/icons-react";
import { useEffect, useState } from "react";

interface Props {
  running: boolean;
  onRun: () => void;
  onCancel: () => void;
  disabled?: boolean;
  label?: string;
  runningLabel?: string;
  title?: string;
  className?: string;
}

export const ExecuteButton = ({
  running,
  onRun,
  onCancel,
  disabled = false,
  label = "Run",
  runningLabel = "Running…",
  title,
  className = "",
}: Props) => {
  const [runningMs, setRunningMs] = useState(0);
  useEffect(() => {
    if (!running) {
      setRunningMs(0);
      return;
    }
    const start = performance.now();
    setRunningMs(0);
    const interval = window.setInterval(() => setRunningMs(performance.now() - start), 200);
    return () => window.clearInterval(interval);
  }, [running]);

  const canCancel = running && runningMs >= 1000;

  return (
    <button
      type="button"
      onClick={running ? onCancel : onRun}
      disabled={disabled || (running && !canCancel)}
      title={canCancel ? "Cancel running query" : title}
      className={`btn h-9 w-36 px-4 text-[13px] ${canCancel
        ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-700/50 dark:bg-red-500/15 dark:text-red-200 dark:hover:bg-red-500/25"
        : "btn-primary"} ${className}`}
    >
      {running
        ? <><IconLoader2 size={15} className="animate-spin" /> {canCancel ? "Cancel" : runningLabel}</>
        : <><IconPlayerPlayFilled size={15} /> {label}</>}
    </button>
  );
};