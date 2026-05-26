// Modal viewer for a single GridFS file. Routes by content-type / filename
// extension to an inline preview (image / text-via-Monaco / pdf-iframe) and
// falls back to a download button for anything we can't render in-browser.
import {
  IconDownload,
  IconExternalLink,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import * as monaco from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type GridFsFileMeta,
  extractIdString,
  gridFsDownloadUrl,
  stringifyEJSON,
} from "../../api/client";
import { useSettings } from "../../settings";

interface Props {
  cid: string;
  bucket: string;
  database: string | undefined;
  file: GridFsFileMeta;
  onClose: () => void;
  onDelete?: (file: GridFsFileMeta) => void;
}

type TabKey = "preview" | "document";

type ViewerKind = "image" | "text" | "pdf" | "audio" | "video" | "binary";

// Best-effort content-type fallback when GridFS metadata doesn't include one.
const EXT_TO_CT: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  jsonl: "application/x-ndjson",
  xml: "application/xml",
  yml: "text/yaml",
  yaml: "text/yaml",
  toml: "text/plain",
  ini: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  jsx: "text/javascript",
  py: "text/x-python",
  rb: "text/x-ruby",
  rs: "text/rust",
  go: "text/x-go",
  java: "text/x-java",
  c: "text/x-csrc",
  h: "text/x-chdr",
  cpp: "text/x-c++src",
  sh: "text/x-shellscript",
  sql: "text/x-sql",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

const guessContentType = (filename: string): string | null => {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_TO_CT[filename.slice(dot + 1).toLowerCase()] ?? null;
};

/** Resolve the best content-type for a GridFS file: top-level field first
 * (older drivers / explicit uploads), then `metadata.contentType` (current
 * convention), then a filename-extension guess. Returns null if nothing
 * yields a hint — callers default to `application/octet-stream`. */
export const resolveFileContentType = (
  file: Pick<GridFsFileMeta, "filename" | "contentType" | "metadata">,
): string | null => {
  if (file.contentType) return String(file.contentType).toLowerCase();
  const metaCt = (file.metadata as { contentType?: unknown } | undefined)
    ?.contentType;
  if (typeof metaCt === "string" && metaCt) return metaCt.toLowerCase();
  return guessContentType(file.filename);
};

const resolveViewerKind = (
  contentType: string,
  filename: string,
): { kind: ViewerKind; monacoLanguage?: string } => {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("image/")) return { kind: "image" };
  if (ct === "application/pdf") return { kind: "pdf" };
  if (ct.startsWith("audio/")) return { kind: "audio" };
  if (ct.startsWith("video/")) return { kind: "video" };
  const lang = monacoLanguageFor(ct, filename);
  if (lang) return { kind: "text", monacoLanguage: lang };
  // Anything else is opaque — offer a download.
  return { kind: "binary" };
};

// Map content-type/extension to a Monaco language. Returning null means "not a
// text format we want to preview" — we fall through to the binary viewer.
const monacoLanguageFor = (ct: string, filename: string): string | null => {
  const ext = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
    : "";

  if (ct === "application/json" || ct === "application/x-ndjson" || ext === "json") {
    return "json";
  }
  if (ct === "application/xml" || ct === "text/xml" || ext === "xml") return "xml";
  if (ct === "image/svg+xml" || ext === "svg") return "xml";
  if (ct === "text/html" || ext === "html" || ext === "htm") return "html";
  if (ct === "text/css" || ext === "css") return "css";
  if (ct === "text/markdown" || ext === "md" || ext === "markdown") {
    return "markdown";
  }
  if (ct.includes("typescript") || ext === "ts" || ext === "tsx") {
    return "typescript";
  }
  if (
    ct.includes("javascript") ||
    ext === "js" ||
    ext === "jsx" ||
    ext === "mjs" ||
    ext === "cjs"
  ) {
    return "javascript";
  }
  if (ext === "yml" || ext === "yaml" || ct.includes("yaml")) return "yaml";
  if (ext === "py" || ct.includes("python")) return "python";
  if (ext === "sql") return "sql";
  if (ext === "rs") return "rust";
  if (ext === "go") return "go";
  if (ext === "java") return "java";
  if (ext === "sh" || ct.includes("shell")) return "shell";
  // text/* without a more specific match — show as plain text in Monaco.
  if (ct.startsWith("text/") || ct === "application/x-yaml") {
    return "plaintext";
  }
  return null;
};

const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024; // 2 MiB hard cap on text preview.

interface ViewOverride {
  label: string;
  value: string;
  // When kind is null the resolver does its normal auto-detect.
  kind: ViewerKind | null;
  language?: string;
}

const VIEW_OVERRIDES: ViewOverride[] = [
  { label: "Auto", value: "auto", kind: null },
  { label: "Image", value: "image", kind: "image" },
  { label: "PDF", value: "pdf", kind: "pdf" },
  { label: "Audio", value: "audio", kind: "audio" },
  { label: "Video", value: "video", kind: "video" },
  { label: "Text", value: "text:plaintext", kind: "text", language: "plaintext" },
  { label: "JSON", value: "text:json", kind: "text", language: "json" },
  { label: "Markdown", value: "text:markdown", kind: "text", language: "markdown" },
  { label: "HTML", value: "text:html", kind: "text", language: "html" },
  { label: "XML / SVG", value: "text:xml", kind: "text", language: "xml" },
  { label: "CSS", value: "text:css", kind: "text", language: "css" },
  { label: "JavaScript", value: "text:javascript", kind: "text", language: "javascript" },
  { label: "TypeScript", value: "text:typescript", kind: "text", language: "typescript" },
  { label: "YAML", value: "text:yaml", kind: "text", language: "yaml" },
  { label: "SQL", value: "text:sql", kind: "text", language: "sql" },
  { label: "Download only", value: "binary", kind: "binary" },
];

export const GridFsViewer = ({
  cid,
  bucket,
  database,
  file,
  onClose,
  onDelete,
}: Props) => {
  const fileId = extractIdString(file._id);
  const [tab, setTab] = useState<TabKey>("preview");
  // Reset to preview when a different file is selected.
  useEffect(() => {
    setTab("preview");
  }, [fileId]);
  const inlineUrl = useMemo(
    () => gridFsDownloadUrl({ cid, bucket, fileId, database, inline: true }),
    [cid, bucket, fileId, database],
  );
  const downloadUrl = useMemo(
    () => gridFsDownloadUrl({ cid, bucket, fileId, database }),
    [cid, bucket, fileId, database],
  );

  const contentType = resolveFileContentType(file) ?? "application/octet-stream";
  const autoViewer = useMemo(
    () => resolveViewerKind(contentType, file.filename),
    [contentType, file.filename],
  );

  const [override, setOverride] = useState<string>("auto");
  // Reset the override whenever a different file is opened — the previously
  // forced view rarely makes sense for the new file.
  useEffect(() => {
    setOverride("auto");
  }, [fileId]);

  const viewer = useMemo(() => {
    const choice = VIEW_OVERRIDES.find((v) => v.value === override);
    if (!choice || choice.kind === null) return autoViewer;
    if (choice.kind === "text") {
      return { kind: "text" as const, monacoLanguage: choice.language ?? "plaintext" };
    }
    return { kind: choice.kind };
  }, [override, autoViewer]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onDownload = () => {
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.rel = "noopener";
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-stretch justify-end bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-1/2 min-w-[480px] flex-col border-l border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {file.filename}
            </div>
            <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {contentType} · {formatBytes(file.length)}
            </div>
          </div>
          <a
            href={inlineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Open in new tab"
          >
            <IconExternalLink size={14} />
          </a>
          <button
            type="button"
            onClick={onDownload}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Download"
          >
            <IconDownload size={14} />
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(file)}
              className="rounded p-1 text-slate-500 hover:bg-red-100 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
              title="Delete"
            >
              <IconTrash size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Close"
          >
            <IconX size={14} />
          </button>
        </header>

        <div className="flex items-center gap-1 border-b border-slate-200 px-2 dark:border-slate-700">
          <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
            Preview
          </TabButton>
          <TabButton active={tab === "document"} onClick={() => setTab("document")}>
            Document
          </TabButton>
          <div className="flex-1" />
          {tab === "preview" && (
            <label className="flex items-center gap-1.5 pr-1 text-[11px] text-slate-500 dark:text-slate-400">
              View as
              <select
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                {VIEW_OVERRIDES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                    {opt.value === "auto" ? ` (${autoViewer.kind})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden bg-slate-50 dark:bg-slate-950">
          {tab === "preview" && (
            <>
              {viewer.kind === "image" && <ImagePreview src={inlineUrl} alt={file.filename} />}
              {viewer.kind === "pdf" && <PdfPreview src={inlineUrl} />}
              {viewer.kind === "audio" && (
                <AudioPreview src={inlineUrl} contentType={contentType} />
              )}
              {viewer.kind === "video" && (
                <VideoPreview src={inlineUrl} contentType={contentType} />
              )}
              {viewer.kind === "text" && (
                <TextPreview
                  url={inlineUrl}
                  language={viewer.monacoLanguage ?? "plaintext"}
                  size={file.length}
                  onDownload={onDownload}
                />
              )}
              {viewer.kind === "binary" && (
                <BinaryFallback
                  filename={file.filename}
                  contentType={contentType}
                  onDownload={onDownload}
                />
              )}
            </>
          )}
          {tab === "document" && <DocumentTab file={file} />}
        </div>
      </div>
    </div>
  );
};

const TabButton = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={[
      "border-b-2 px-3 py-1.5 text-[12px] font-medium",
      active
        ? "border-sky-500 text-sky-700 dark:text-sky-300"
        : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
    ].join(" ")}
  >
    {children}
  </button>
);

const DocumentTab = ({ file }: { file: GridFsFileMeta }) => {
  const { theme } = useSettings();
  const hostRef = useRef<HTMLDivElement | null>(null);

  const docText = useMemo(() => {
    // Pretty-print the full GridFS files document in canonical EJSON so types
    // (ObjectId, Date, Long) render in their `$oid` / `$date` / `$numberLong`
    // form — same shape the documents table shows for regular collections.
    try {
      return JSON.stringify(JSON.parse(stringifyEJSON(file)), null, 2);
    } catch {
      return stringifyEJSON(file);
    }
  }, [file]);

  useEffect(() => {
    if (!hostRef.current) return;
    const editor = monaco.editor.create(hostRef.current, {
      value: docText,
      language: "json",
      theme: theme === "dark" ? "vs-dark" : "vs",
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontFamily:
        "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12.5,
      lineNumbers: "on",
      folding: true,
      contextmenu: false,
      padding: { top: 6, bottom: 6 },
    });
    return () => editor.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docText]);

  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  }, [theme]);

  return <div ref={hostRef} className="h-full w-full" />;
};

const ImagePreview = ({ src, alt }: { src: string; alt: string }) => (
  <div className="flex h-full w-full items-center justify-center overflow-auto p-4">
    {/* Checkerboard background helps transparent PNGs / SVGs read clearly. */}
    <div
      className="max-h-full max-w-full rounded shadow-sm"
      style={{
        backgroundImage:
          "linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)",
        backgroundSize: "16px 16px",
        backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
      }}
    >
      <img
        src={src}
        alt={alt}
        className="block max-h-[78vh] max-w-full object-contain"
      />
    </div>
  </div>
);

const PdfPreview = ({ src }: { src: string }) => (
  <iframe
    title="PDF preview"
    src={src}
    className="h-full w-full border-0 bg-white"
  />
);

const AudioPreview = ({
  src,
  contentType,
}: {
  src: string;
  contentType: string;
}) => (
  <div className="flex h-full items-center justify-center p-6">
    <audio controls src={src} className="w-full max-w-xl">
      <source src={src} type={contentType} />
    </audio>
  </div>
);

const VideoPreview = ({
  src,
  contentType,
}: {
  src: string;
  contentType: string;
}) => (
  <div className="flex h-full items-center justify-center bg-black p-2">
    <video controls src={src} className="max-h-full max-w-full">
      <source src={src} type={contentType} />
    </video>
  </div>
);

interface TextPreviewProps {
  url: string;
  language: string;
  size: number;
  onDownload: () => void;
}

const TextPreview = ({ url, language, size, onDownload }: TextPreviewProps) => {
  const { theme } = useSettings();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const oversized = size > TEXT_PREVIEW_LIMIT;

  useEffect(() => {
    if (oversized) return;
    let cancelled = false;
    setContent(null);
    setError(null);
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url, oversized]);

  useEffect(() => {
    if (!hostRef.current || content == null) return;
    const editor = monaco.editor.create(hostRef.current, {
      value: content,
      language,
      theme: theme === "dark" ? "vs-dark" : "vs",
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontFamily:
        "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12.5,
      lineNumbers: "on",
      glyphMargin: false,
      folding: true,
      contextmenu: false,
      padding: { top: 6, bottom: 6 },
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // language/theme handled via separate effect below to avoid full remount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  useEffect(() => {
    if (editorRef.current) {
      monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
    }
  }, [theme]);

  if (oversized) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-sm text-slate-600 dark:text-slate-300">
          File is too large to preview ({formatBytes(size)}).
        </div>
        <button
          type="button"
          onClick={onDownload}
          className="flex items-center gap-1.5 rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400"
        >
          <IconDownload size={14} />
          Download
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-red-600 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (content == null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-slate-500 dark:text-slate-400">
        Loading…
      </div>
    );
  }

  return <div ref={hostRef} className="h-full w-full" />;
};

const BinaryFallback = ({
  filename,
  contentType,
  onDownload,
}: {
  filename: string;
  contentType: string;
  onDownload: () => void;
}) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
    <div className="text-sm text-slate-600 dark:text-slate-300">
      No inline preview for <span className="font-mono">{filename}</span>
    </div>
    <div className="text-xs text-slate-500 dark:text-slate-400">
      Content-Type: <span className="font-mono">{contentType}</span>
    </div>
    <button
      type="button"
      onClick={onDownload}
      className="mt-2 flex items-center gap-1.5 rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400"
    >
      <IconDownload size={14} />
      Download
    </button>
  </div>
);

const formatBytes = (n: number | null | undefined): string => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};
