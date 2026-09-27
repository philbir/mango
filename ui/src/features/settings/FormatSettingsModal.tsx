import { IconX } from "@tabler/icons-react";
import {
  Binary,
  Decimal128,
  Double,
  Int32,
  Long,
  ObjectId,
} from "bson";
import { useEffect, useMemo } from "react";
import {
  type DateDisplay,
  type JsonViewFormat,
  type UuidRepresentation,
  useSettings,
} from "../../settings";
import {
  JSON_VIEW_FORMATS,
  formatCellValue,
  formatDocument,
} from "../documents/docFormats";

interface Props {
  onClose: () => void;
}

const UUID_REPRESENTATIONS: ReadonlyArray<{
  value: UuidRepresentation;
  label: string;
  hint: string;
}> = [
  { value: "standard", label: "Standard", hint: "Subtype 4, RFC 4122 byte order" },
  { value: "csharpLegacy", label: "C# Legacy", hint: "Subtype 3, .NET byte order — CSUUID(…)" },
  { value: "javaLegacy", label: "Java Legacy", hint: "Subtype 3, Java byte order — JUUID(…)" },
  { value: "pythonLegacy", label: "Python Legacy", hint: "Subtype 3, standard order — PYUUID(…)" },
  { value: "unspecified", label: "Unspecified", hint: "Subtype 3, no byte swap" },
];

const DATE_DISPLAYS: ReadonlyArray<{
  value: DateDisplay;
  label: string;
  hint: string;
}> = [
  { value: "local", label: "Local time", hint: "2026-05-07T17:44:20.091+02:00" },
  { value: "utc", label: "UTC", hint: "2026-05-07T15:44:20.091Z" },
];

// Covers every type whose rendering the options below change.
const SAMPLE: Record<string, unknown> = {
  _id: new ObjectId("6ab939d41033c9ad3c501ff2"),
  sku: "OUT-0029",
  price: Decimal128.fromString("425.33"),
  stock: new Int32(136),
  rating: new Double(4.5),
  views: Long.fromString("9007199254740993"),
  legacyId: new Binary(
    Uint8Array.from([
      0x67, 0x45, 0x23, 0x01, 0xab, 0x89, 0xef, 0xcd,
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
    ]),
    Binary.SUBTYPE_UUID_OLD,
  ),
  attributes: { color: "silver", featured: true },
  createdAt: new Date("2026-05-07T15:44:20.091Z"),
};

/**
 * Global display formats — one place that decides how documents read across
 * the result list, the document viewer and the update editor.
 */
export const FormatSettingsModal = ({ onClose }: Props) => {
  const settings = useSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const preview = useMemo(
    () => formatDocument(SAMPLE, settings.jsonFormat, settings.formatOptions),
    [settings.jsonFormat, settings.formatOptions],
  );
  const cellPreview = useMemo(
    () =>
      (["_id", "price", "legacyId", "createdAt"] as const).map((k) => ({
        key: k,
        value: formatCellValue(SAMPLE[k], settings.formatOptions),
      })),
    [settings.formatOptions],
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[680px] max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex-1">
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Formats
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              How documents are shown in the result list, the document viewer
              and the update editor. Changes apply immediately.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon btn-ghost"
            title="Close (Esc)"
          >
            <IconX size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="w-[380px] flex-shrink-0 space-y-5 overflow-y-auto border-r border-slate-200 px-5 py-4 dark:border-slate-800">
            <Group label="JSON view format">
              <RadioList<JsonViewFormat>
                name="jsonFormat"
                value={settings.jsonFormat}
                onChange={settings.setJsonFormat}
                options={JSON_VIEW_FORMATS}
              />
            </Group>

            <Group label="Display DateTime in">
              <RadioList<DateDisplay>
                name="dateDisplay"
                value={settings.dateDisplay}
                onChange={settings.setDateDisplay}
                options={DATE_DISPLAYS}
              />
            </Group>

            <Group
              label="Legacy UUID representation"
              hint="Byte order used to read and write subtype-3 UUIDs. Subtype 4 is always standard."
            >
              <RadioList<UuidRepresentation>
                name="uuidRepresentation"
                value={settings.uuidRepresentation}
                onChange={settings.setUuidRepresentation}
                options={UUID_REPRESENTATIONS}
              />
            </Group>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-slate-50 px-5 py-4 dark:bg-slate-950/40">
            <div>
              <PreviewLabel>Viewer &amp; editor</PreviewLabel>
              <pre className="overflow-auto rounded border border-slate-200 bg-white px-3 py-2 font-mono text-[11.5px] leading-relaxed text-slate-800 [tab-size:2] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {preview}
              </pre>
              {settings.jsonFormat === "json" && (
                <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Plain JSON loses BSON types, so the update editor uses the
                  shell format instead.
                </div>
              )}
            </div>
            <div>
              <PreviewLabel>Table cells</PreviewLabel>
              <div className="overflow-hidden rounded border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                {cellPreview.map((c) => (
                  <div
                    key={c.key}
                    className="flex gap-3 border-b border-slate-100 px-3 py-1 font-mono text-[11.5px] last:border-b-0 dark:border-slate-800"
                  >
                    <span className="w-20 flex-shrink-0 text-slate-400">
                      {c.key}
                    </span>
                    <span className="truncate text-slate-800 dark:text-slate-200">
                      {c.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer className="flex justify-end border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-primary"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
};

const Group = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <section>
    <div className="eyebrow">
      {label}
    </div>
    {hint && (
      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-500">
        {hint}
      </div>
    )}
    <div className="mt-2">{children}</div>
  </section>
);

const PreviewLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 eyebrow">
    {children}
  </div>
);

function RadioList<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; hint: string }>;
}) {
  return (
    <div className="space-y-0.5">
      {options.map((opt) => (
        <label
          key={opt.value}
          className={[
            "flex cursor-pointer items-start gap-2 rounded px-2 py-1.5",
            value === opt.value
              ? "bg-sky-500/10 dark:bg-sky-500/15"
              : "hover:bg-slate-100 dark:hover:bg-slate-800",
          ].join(" ")}
        >
          <input
            type="radio"
            name={name}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="mt-0.5 h-3.5 w-3.5 text-sky-500 focus:ring-sky-500"
          />
          <span className="min-w-0">
            <span className="block text-xs text-slate-800 dark:text-slate-100">
              {opt.label}
            </span>
            <span className="block truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {opt.hint}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}
