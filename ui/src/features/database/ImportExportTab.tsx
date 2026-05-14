import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  IconArchive,
  IconDownload,
  IconRestore,
  IconUpload,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { ApiError, api, type ToolResult } from "../../api/client";
import { useDatabaseStats } from "./useDatabaseStats";

interface Props {
  cid: string;
  database: string;
}

type ImportMode = "insert" | "upsert" | "merge";

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const ImportExportTab = ({ cid, database }: Props) => {
  const queryClient = useQueryClient();
  const stats = useDatabaseStats(cid, database);
  const collections = stats.data?.collections ?? [];

  const [exportCol, setExportCol] = useState("");
  const [importCol, setImportCol] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("insert");
  const [importDrop, setImportDrop] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreDrop, setRestoreDrop] = useState(false);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const exportMut = useMutation({
    mutationFn: async () => {
      const blob = await api.exportCollection(cid, database, exportCol);
      triggerDownload(blob, `${database}.${exportCol}.json`);
    },
  });

  const importMut = useMutation<ToolResult, Error, void>({
    mutationFn: async () => {
      if (!importFile) throw new Error("Pick a file first.");
      return api.importCollection({
        cid,
        db: database,
        collection: importCol,
        file: importFile,
        mode: importMode,
        drop: importDrop,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["database-stats", cid, database],
      });
      queryClient.invalidateQueries({ queryKey: ["collections", cid, database] });
    },
  });

  const dumpMut = useMutation({
    mutationFn: async () => {
      const blob = await api.dumpDatabase(cid, database);
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      triggerDownload(blob, `${database}-${ts}.archive.gz`);
    },
  });

  const restoreMut = useMutation<ToolResult, Error, void>({
    mutationFn: async () => {
      if (!restoreFile) throw new Error("Pick an archive first.");
      return api.restoreDatabase({
        cid,
        db: database,
        file: restoreFile,
        drop: restoreDrop,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["database-stats", cid, database],
      });
      queryClient.invalidateQueries({ queryKey: ["collections", cid, database] });
    },
  });

  const errorMessage = (err: unknown): string | null => {
    if (!err) return null;
    if (err instanceof ApiError) return err.message;
    if (err instanceof Error) return err.message;
    return String(err);
  };

  return (
    <div className="space-y-6 p-5">
      <header>
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Import &amp; export
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Uses the MongoDB Database Tools (mongoexport / mongoimport / mongodump
          / mongorestore) shipped with the server image.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <IconDownload size={14} /> Export collection
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Downloads a single collection as a JSON array via{" "}
            <span className="font-mono">mongoexport</span>.
          </p>
          <div className="mt-3 space-y-2">
            <select
              value={exportCol}
              onChange={(e) => setExportCol(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">Pick a collection…</option>
              {collections.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!exportCol || exportMut.isPending}
              onClick={() => exportMut.mutate()}
              className="w-full rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {exportMut.isPending ? "Exporting…" : "Export"}
            </button>
            {errorMessage(exportMut.error) && (
              <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                {errorMessage(exportMut.error)}
              </div>
            )}
          </div>
        </div>

        <div className="rounded border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <IconUpload size={14} /> Import collection
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Uploads a JSON array file to a collection via{" "}
            <span className="font-mono">mongoimport</span>.
          </p>
          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={importCol}
              onChange={(e) => setImportCol(e.target.value)}
              placeholder="Target collection name"
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-700 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-medium dark:text-slate-300 dark:file:bg-slate-800 dark:file:text-slate-200"
            />
            <div className="flex items-center gap-2">
              <select
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as ImportMode)}
                className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="insert">insert</option>
                <option value="upsert">upsert</option>
                <option value="merge">merge</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={importDrop}
                  onChange={(e) => setImportDrop(e.target.checked)}
                />
                --drop
              </label>
            </div>
            <button
              type="button"
              disabled={!importCol || !importFile || importMut.isPending}
              onClick={() => importMut.mutate()}
              className="w-full rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {importMut.isPending ? "Importing…" : "Import"}
            </button>
            {importMut.data && (
              <ToolOutput result={importMut.data} />
            )}
            {errorMessage(importMut.error) && (
              <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                {errorMessage(importMut.error)}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <IconArchive size={14} /> Dump database
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Downloads the entire database as a gzipped archive via{" "}
            <span className="font-mono">mongodump --archive --gzip</span>.
          </p>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              disabled={dumpMut.isPending}
              onClick={() => dumpMut.mutate()}
              className="w-full rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {dumpMut.isPending ? "Dumping…" : "Dump database"}
            </button>
            {errorMessage(dumpMut.error) && (
              <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                {errorMessage(dumpMut.error)}
              </div>
            )}
          </div>
        </div>

        <div className="rounded border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <IconRestore size={14} /> Restore database
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Restores from a <span className="font-mono">.archive.gz</span> via{" "}
            <span className="font-mono">mongorestore</span>. Source db namespace
            is rewritten into{" "}
            <span className="font-mono">{database}</span>.
          </p>
          <div className="mt-3 space-y-2">
            <input
              ref={restoreInputRef}
              type="file"
              accept=".gz,.archive,application/gzip"
              onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-700 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-medium dark:text-slate-300 dark:file:bg-slate-800 dark:file:text-slate-200"
            />
            <label className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={restoreDrop}
                onChange={(e) => setRestoreDrop(e.target.checked)}
              />
              --drop existing collections before restore
            </label>
            <button
              type="button"
              disabled={!restoreFile || restoreMut.isPending}
              onClick={() => restoreMut.mutate()}
              className="w-full rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {restoreMut.isPending ? "Restoring…" : "Restore"}
            </button>
            {restoreMut.data && <ToolOutput result={restoreMut.data} />}
            {errorMessage(restoreMut.error) && (
              <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                {errorMessage(restoreMut.error)}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

const ToolOutput = ({ result }: { result: ToolResult }) => {
  if (!result.stderr) {
    return (
      <div className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300">
        Done.
      </div>
    );
  }
  return (
    <pre className="max-h-48 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] leading-snug text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
      {result.stderr}
    </pre>
  );
};
