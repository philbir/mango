import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type AssistantMode =
  | "collection"
  | "console"
  | "shell"
  | "general"
  | "indexes";

export interface AssistantExtraContext {
  /** Pre-rendered list of indexes for the assistant prompt. */
  indexes?: string | null;
  /** Pre-rendered explain output for the assistant prompt. */
  explain?: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  // Provider/model used to produce this assistant message.
  meta?: { provider: string; model: string };
  // Marked when the assistant is mid-stream (we don't actually stream — this is
  // just the spinner placeholder used while the request is in flight).
  pending?: boolean;
  error?: string;
}

export type ApplyKind =
  | "filter"
  | "projection"
  | "sort"
  | "pipeline"
  | "shell"
  | "console";

export interface ApplyHandlers {
  /** What kind of apply targets this view supports. The panel only shows the
   * Apply button for kinds the active tab handles. */
  supports: ApplyKind[];
  apply: (kind: ApplyKind, payload: string) => void;
}

interface AssistantContextValue {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
  width: number;
  setWidth: (w: number) => void;
  // Active context (set by the active tab via useAssistantBinding).
  mode: AssistantMode;
  collection: string | null;
  // Optional richer context (indexes / explain output) the active view may
  // attach to inform the assistant's reasoning.
  extraContext: AssistantExtraContext;
  setExtraContext: (next: AssistantExtraContext) => void;
  // Threads per tab id; "global" if no tab.
  messages: ChatMessage[];
  appendMessage: (m: ChatMessage) => void;
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  resetThread: () => void;
  // Apply handlers: the active tab registers these.
  bindHandlers: (h: ApplyHandlers | null) => void;
  applyArtifact: (kind: ApplyKind, payload: string) => boolean;
  supports: (kind: ApplyKind) => boolean;
  // The tab id we're tracking — used as the message thread key.
  activeKey: string;
  setActiveKey: (key: string) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

const WIDTH_KEY = "mango:assistant:width";
const OPEN_KEY = "mango:assistant:open";
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;
const MAX_WIDTH = 800;

const genId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const readNum = (key: string, fallback: number): number => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
};

const readBool = (key: string, fallback: boolean): boolean => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
};

export const AssistantProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [open, setOpenState] = useState<boolean>(() => readBool(OPEN_KEY, false));
  const [width, setWidthState] = useState<number>(() =>
    Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, readNum(WIDTH_KEY, DEFAULT_WIDTH))),
  );

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  const setWidth = useCallback((w: number) => {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
    setWidthState(clamped);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }, []);

  const [mode, setMode] = useState<AssistantMode>("general");
  const [collection, setCollection] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string>("__none__");
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const [extraContext, setExtraContextState] = useState<AssistantExtraContext>({});

  const setExtraContext = useCallback((next: AssistantExtraContext) => {
    setExtraContextState((prev) => {
      // Avoid an infinite re-render: only update when the values actually
      // change. Indexes / explain text are usually stable across renders.
      if (prev.indexes === next.indexes && prev.explain === next.explain) {
        return prev;
      }
      return next;
    });
  }, []);

  const handlersRef = useRef<ApplyHandlers | null>(null);

  const messages = threads[activeKey] ?? [];

  const appendMessage = useCallback(
    (m: ChatMessage) => {
      setThreads((prev) => ({
        ...prev,
        [activeKey]: [...(prev[activeKey] ?? []), m],
      }));
    },
    [activeKey],
  );

  const patchMessage = useCallback(
    (id: string, patch: Partial<ChatMessage>) => {
      setThreads((prev) => {
        const list = prev[activeKey] ?? [];
        const next = list.map((m) => (m.id === id ? { ...m, ...patch } : m));
        return { ...prev, [activeKey]: next };
      });
    },
    [activeKey],
  );

  const resetThread = useCallback(() => {
    setThreads((prev) => ({ ...prev, [activeKey]: [] }));
  }, [activeKey]);

  const bindHandlers = useCallback((h: ApplyHandlers | null) => {
    handlersRef.current = h;
  }, []);

  const applyArtifact = useCallback(
    (kind: ApplyKind, payload: string): boolean => {
      const h = handlersRef.current;
      if (!h) return false;
      if (!h.supports.includes(kind)) return false;
      h.apply(kind, payload);
      return true;
    },
    [],
  );

  const supports = useCallback((kind: ApplyKind): boolean => {
    const h = handlersRef.current;
    return !!h && h.supports.includes(kind);
  }, []);

  // Listen to a custom event so views can update mode/collection without
  // prop-drilling. Views call `useAssistantBinding(...)`.
  useEffect(() => {
    const onCtx = (e: Event) => {
      const detail = (e as CustomEvent<{
        mode: AssistantMode;
        collection: string | null;
        key: string;
      }>).detail;
      if (!detail) return;
      setMode(detail.mode);
      setCollection(detail.collection);
      setActiveKey(detail.key);
    };
    window.addEventListener("mango:assistant:bind", onCtx);
    return () => window.removeEventListener("mango:assistant:bind", onCtx);
  }, []);

  const value = useMemo<AssistantContextValue>(
    () => ({
      open,
      setOpen,
      toggle,
      width,
      setWidth,
      mode,
      collection,
      extraContext,
      setExtraContext,
      messages,
      appendMessage,
      patchMessage,
      resetThread,
      bindHandlers,
      applyArtifact,
      supports,
      activeKey,
      setActiveKey,
    }),
    [
      open,
      setOpen,
      toggle,
      width,
      setWidth,
      mode,
      collection,
      extraContext,
      setExtraContext,
      messages,
      appendMessage,
      patchMessage,
      resetThread,
      bindHandlers,
      applyArtifact,
      supports,
      activeKey,
    ],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
};

export const useAssistant = (): AssistantContextValue => {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within AssistantProvider");
  return ctx;
};

export const newMessageId = genId;

/**
 * Views call this to tell the assistant which tab is active and what context
 * applies. They also pass apply handlers — when the assistant proposes a
 * filter/command/etc., the panel calls these to push the artifact into the view.
 */
export const useAssistantBinding = (params: {
  key: string;
  mode: AssistantMode;
  collection: string | null;
  handlers: ApplyHandlers;
}) => {
  const { key, mode, collection, handlers } = params;
  const { bindHandlers } = useAssistant();

  // Update context (mode/collection/key) — does not require listening to the
  // assistant context itself, broadcast via window event.
  useEffect(() => {
    const event = new CustomEvent("mango:assistant:bind", {
      detail: { mode, collection, key },
    });
    window.dispatchEvent(event);
  }, [key, mode, collection]);

  // Bind handlers (kept fresh through closure capture).
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    bindHandlers({
      supports: handlers.supports,
      apply: (kind, payload) => handlersRef.current.apply(kind, payload),
    });
    return () => bindHandlers(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindHandlers, handlers.supports.join("|")]);
};
