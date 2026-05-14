import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { api, ApiError } from "./api/client";
import { App } from "./app";
import { Toaster } from "./components/Toaster";
import { showToast } from "./components/toasts";
import { AssistantProvider } from "./features/assistant/AssistantContext";
import { TabsProvider } from "./features/tabs/TabsContext";
import { ActiveDatabaseProvider } from "./features/connections/useActiveDatabase";
import "./index.css";
import "./monaco-setup";
import { SettingsProvider } from "./settings";

const describeQueryKey = (key: readonly unknown[]): string => {
  if (key.length === 0) return "request";
  const head = String(key[0] ?? "request");
  return head.replace(/[-_]/g, " ");
};

const reportError = (error: unknown, source: string) => {
  // Don't spam the toaster with auth-related expected redirects.
  if (error instanceof ApiError && error.status === 401) return;
  const status = error instanceof ApiError ? ` (${error.status})` : "";
  const message = error instanceof Error ? error.message : String(error);
  let serverConfigLogsAvailable = false;
  try {
    const cached = queryClient.getQueryData<{ logsAvailable?: boolean }>([
      "server-config",
    ]);
    serverConfigLogsAvailable = !!cached?.logsAvailable;
  } catch {
    /* ignore */
  }
  showToast({
    kind: "error",
    title: `Could not load ${source}${status}`,
    detail: message,
    actions: serverConfigLogsAvailable
      ? [
          {
            label: "Open logs",
            onClick: async () => {
              try {
                await api.revealLogs();
              } catch (e) {
                showToast({
                  kind: "error",
                  title: "Could not open log folder",
                  detail: e instanceof Error ? e.message : String(e),
                });
              }
            },
          },
        ]
      : undefined,
  });
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      const head = query.queryKey[0];
      // Connection-health failures are already surfaced by the picker's red
      // icon and the sidebar's "Not connected" panel. Toasts on top would
      // flood the screen on every retry tick.
      if (head === "connection-health") return;
      // Sidebar database/collection lists render their own inline error
      // panel — a parallel toast is duplicate noise. When these fail with
      // a connection-style error (ECONNREFUSED, timeout, network unreachable)
      // we also invalidate the health query so the picker flips to red and
      // the "Not connected" panel replaces the inline message on the next
      // tick.
      if (head === "databases" || head === "collections") {
        const message = error instanceof Error ? error.message : String(error);
        if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|timed out|server selection/i.test(message)) {
          // queryKey is ["databases", cid] or ["collections", cid, db].
          const cid = query.queryKey[1];
          if (typeof cid === "string") {
            queryClient.invalidateQueries({ queryKey: ["connection-health", cid] });
          }
        }
        return;
      }
      reportError(error, describeQueryKey(query.queryKey));
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      reportError(error, "the request");
    },
  }),
});

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <SettingsProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TabsProvider>
            <ActiveDatabaseProvider>
              <AssistantProvider>
                <App />
                <Toaster />
              </AssistantProvider>
            </ActiveDatabaseProvider>
          </TabsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </SettingsProvider>
  </StrictMode>,
);
