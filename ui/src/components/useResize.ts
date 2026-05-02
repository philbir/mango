import { useCallback, useEffect, useRef, useState } from "react";

interface ResizeOptions {
  storageKey: string;
  axis: "x" | "y";
  initial: number;
  min: number;
  max: number;
}

const readStored = (key: string, fallback: number): number => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const writeStored = (key: string, value: number) => {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
};

/**
 * Drives a draggable splitter. `size` is the current size; `onMouseDown` is the
 * splitter handle's pointer-down. `axis: "x"` resizes width (drag right grows),
 * `axis: "y"` resizes height (drag down grows).
 */
export const useResize = ({
  storageKey,
  axis,
  initial,
  min,
  max,
}: ResizeOptions) => {
  const [size, setSize] = useState<number>(() =>
    readStored(storageKey, initial),
  );
  const dragRef = useRef<{ start: number; base: number } | null>(null);

  useEffect(() => {
    writeStored(storageKey, size);
  }, [storageKey, size]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = {
        start: axis === "x" ? e.clientX : e.clientY,
        base: size,
      };
      const move = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const current = axis === "x" ? ev.clientX : ev.clientY;
        const delta = current - dragRef.current.start;
        const next = Math.min(
          max,
          Math.max(min, dragRef.current.base + delta),
        );
        setSize(next);
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
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [axis, max, min, size],
  );

  return { size, onMouseDown };
};
