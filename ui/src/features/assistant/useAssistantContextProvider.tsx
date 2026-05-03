import { useEffect } from "react";
import {
  type AssistantExtraContext,
  type AssistantMode,
  useAssistant,
  useAssistantBinding,
} from "./AssistantContext";

/**
 * Convenience hook used by views that want to populate the assistant's
 * `mode` / `collection` context AND attach extra rendered context (like the
 * collection's index list or the most recent explain output).
 *
 * Apply handlers are not relevant for these read-mostly views (Stats,
 * Indexes, Playground), so we register a no-op handler list.
 */
export const useAssistantContextProvider = (params: {
  key: string;
  mode: AssistantMode;
  collection: string | null;
  context: AssistantExtraContext;
}) => {
  const { key, mode, collection, context } = params;
  const { setExtraContext } = useAssistant();

  useAssistantBinding({
    key,
    mode,
    collection,
    handlers: {
      // No artifacts apply directly to the Info view — the AI's `mango-shell`
      // / `mango-console` blocks still surface in the chat with copy buttons.
      supports: [],
      apply: () => {
        /* no-op */
      },
    },
  });

  useEffect(() => {
    setExtraContext({
      indexes: context.indexes ?? null,
      explain: context.explain ?? null,
    });
    // Clear when this view unmounts so subsequent threads don't leak the
    // previous collection's context.
    return () => setExtraContext({ indexes: null, explain: null });
  }, [context.indexes, context.explain, setExtraContext]);
};
