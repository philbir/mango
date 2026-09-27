import {
  IconBraces,
  IconDeviceDesktop,
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
  useSettings,
} from "../settings";
import { AiSettingsModal } from "../features/connections/AiSettingsModal";
import { FormatSettingsModal } from "../features/settings/FormatSettingsModal";

const PAGE_SIZES: PageSize[] = [50, 100, 200, 500];

export const SettingsMenu = () => {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [formatsOpen, setFormatsOpen] = useState(false);
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
        className="btn-icon btn-ghost h-7 w-7"
        title="Settings"
        aria-label="Settings"
      >
        <IconSettings size={16} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-md border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between pb-2">
            <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
              Settings
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-icon btn-ghost"
              aria-label="Close"
            >
              <IconX size={14} />
            </button>
          </div>

          <Section label="Theme">
            <ToggleGroup<Theme>
              value={settings.theme}
              onChange={settings.setTheme}
              options={[
                {
                  value: "system",
                  label: "System",
                  icon: <IconDeviceDesktop size={13} />,
                },
                { value: "dark", label: "Dark", icon: <IconMoon size={13} /> },
                { value: "light", label: "Light", icon: <IconSun size={13} /> },
              ]}
            />
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
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={settings.tabMode}
                onChange={(e) => settings.setTabMode(e.target.checked)}
                className="rounded"
              />
              Tab mode (open each collection in its own tab)
            </label>
          </Section>

          <Section label="Formats">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setFormatsOpen(true);
              }}
              className="btn btn-sm btn-outline w-full justify-start"
            >
              <IconBraces size={13} />
              Configure formats
            </button>
          </Section>

          <Section label="AI">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setAiOpen(true);
              }}
              className="btn btn-sm btn-outline w-full justify-start"
            >
              <IconSparkles size={13} />
              Configure provider
            </button>
          </Section>
        </div>
      )}
      {aiOpen && <AiSettingsModal onClose={() => setAiOpen(false)} />}
      {formatsOpen && (
        <FormatSettingsModal onClose={() => setFormatsOpen(false)} />
      )}
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
    <div className="eyebrow mb-1">{label}</div>
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
            "btn btn-sm",
            value === opt.value
              ? "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
              : "btn-outline font-normal",
          ].join(" ")}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
