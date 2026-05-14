import {
  IconMoon,
  IconSettings,
  IconSparkles,
  IconSun,
  IconTable,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import {
  type CollectionMode,
  type PageSize,
  type Theme,
  type UuidRepresentation,
  useSettings,
} from "../settings";
import { AiSettingsModal } from "../features/connections/AiSettingsModal";

const UUID_REPRESENTATION_LABELS: Record<UuidRepresentation, string> = {
  standard: "Standard (subtype 4, RFC 4122)",
  csharpLegacy: "CSharpLegacy (subtype 3, .NET byte order)",
  javaLegacy: "JavaLegacy (subtype 3, Java byte order)",
  pythonLegacy: "PythonLegacy (subtype 3, standard order)",
  unspecified: "Unspecified (subtype 3, no swap)",
};

const PAGE_SIZES: PageSize[] = [50, 100, 200, 500];

export const SettingsMenu = () => {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        title="Settings"
      >
        <IconSettings size={16} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-md border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between pb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Settings
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <IconX size={14} />
            </button>
          </div>

          <Section label="Theme">
            <ToggleGroup<Theme>
              value={settings.theme}
              onChange={settings.setTheme}
              options={[
                { value: "dark", label: "Dark", icon: <IconMoon size={12} /> },
                { value: "light", label: "Light", icon: <IconSun size={12} /> },
              ]}
            />
          </Section>

          <Section label="UUID representation">
            <select
              value={settings.uuidRepresentation}
              onChange={(e) =>
                settings.setUuidRepresentation(
                  e.target.value as UuidRepresentation,
                )
              }
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {(
                Object.keys(UUID_REPRESENTATION_LABELS) as UuidRepresentation[]
              ).map((r) => (
                <option key={r} value={r}>
                  {UUID_REPRESENTATION_LABELS[r]}
                </option>
              ))}
            </select>
          </Section>

          <Section label="Page size">
            <ToggleGroup<PageSize>
              value={settings.pageSize}
              onChange={settings.setPageSize}
              options={PAGE_SIZES.map((n) => ({ value: n, label: String(n) }))}
            />
          </Section>

          <Section label="Default collection mode">
            <ToggleGroup<CollectionMode>
              value={settings.defaultCollectionMode}
              onChange={settings.setDefaultCollectionMode}
              options={[
                { value: "query", label: "Query", icon: <IconTable size={12} /> },
                {
                  value: "console",
                  label: "Console",
                  icon: <IconTerminal2 size={12} />,
                },
              ]}
            />
          </Section>

          <Section label="Tabs">
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={settings.tabMode}
                onChange={(e) => settings.setTabMode(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-sky-500 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800"
              />
              Tab mode (open each collection in its own tab)
            </label>
          </Section>

          <Section label="AI">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setAiOpen(true);
              }}
              className="flex w-full items-center gap-1.5 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <IconSparkles size={12} />
              Configure provider
            </button>
          </Section>
        </div>
      )}
      {aiOpen && <AiSettingsModal onClose={() => setAiOpen(false)} />}
    </div>
  );
};

const Section = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="mt-2 first:mt-0">
    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {label}
    </div>
    {children}
  </div>
);

interface ToggleOption<T extends string | number> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

function ToggleGroup<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<ToggleOption<T>>;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          onClick={() => onChange(opt.value)}
          className={[
            "flex items-center gap-1 rounded px-2 py-1 text-xs",
            value === opt.value
              ? "bg-sky-500/15 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300"
              : "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800",
          ].join(" ")}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
