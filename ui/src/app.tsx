import { Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./features/collections/Sidebar";
import { CollectionView } from "./features/documents/CollectionView";
import { ShellView } from "./features/shell/ShellView";

export const App = () => {
  return (
    <div className="flex h-full bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <Routes>
          <Route path="/" element={<EmptyState />} />
          <Route path="/c/:name" element={<CollectionView />} />
          <Route path="/shell" element={<ShellView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

const EmptyState = () => (
  <div className="flex h-full items-center justify-center text-center text-slate-500 dark:text-slate-400">
    <div>
      <div className="text-base font-medium text-slate-700 dark:text-slate-200">
        Mongo Manager
      </div>
      <div className="mt-1 text-sm">Pick a collection from the sidebar to start.</div>
    </div>
  </div>
);
