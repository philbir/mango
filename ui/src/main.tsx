import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { App } from "./app";
import { TabsProvider } from "./features/tabs/TabsContext";
import "./index.css";
import "./monaco-setup";
import { SettingsProvider } from "./settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <SettingsProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TabsProvider>
            <App />
          </TabsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </SettingsProvider>
  </StrictMode>,
);
