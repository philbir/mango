import { withBase } from "../../api/base";
import { useQuery } from "@tanstack/react-query";
import { IconCheck, IconCopy, IconDeviceDesktop, IconExternalLink, IconLoader2, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { api, type OidcBrowser } from "../../api/client";
import { BrowserPicker, labelForOidcBrowser } from "./BrowserPicker";

interface Props {
  connectionName: string;
  initialBrowser: OidcBrowser;
  initialBrowserProfile: string | null;
  forceRestart?: boolean;
  confirmLabel?: string;
  message?: React.ReactNode;
  onConfirm: (selection: {
    oidcBrowser: OidcBrowser;
    oidcBrowserProfile: string | null;
    forceRestart: boolean;
    openBrowser: boolean;
  }) => Promise<void> | void;
  onReopen?: (selection: {
    oidcBrowser: OidcBrowser;
    oidcBrowserProfile: string | null;
  }) => Promise<void> | void;
  getAuthUrl: () => Promise<string | null>;
  onSuccess: () => void;
  onCancel: () => Promise<void> | void;
}

export const OidcAuthDialog = ({
  connectionName,
  initialBrowser,
  initialBrowserProfile,
  forceRestart = false,
  confirmLabel = forceRestart ? "Retry authentication" : "Continue",
  message,
  onConfirm,
  onReopen,
  getAuthUrl,
  onSuccess,
  onCancel,
}: Props) => {
  const browserOptions = useQuery({
    queryKey: ["browser-options"],
    queryFn: () => api.listBrowsers(),
    refetchOnMount: "always",
  });
  const [browser, setBrowser] = useState<OidcBrowser>(initialBrowser);
  const [browserProfile, setBrowserProfile] = useState(initialBrowserProfile ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState(false);
  const [authSessionKey, setAuthSessionKey] = useState(() => crypto.randomUUID());
  const authUrl = useQuery({
    queryKey: ["oidc-auth-url", authSessionKey],
    queryFn: getAuthUrl,
    enabled: busy && !succeeded,
    refetchInterval: (query) => query.state.data ? false : 700,
    gcTime: 0,
  });

  useEffect(() => {
    setBrowser(initialBrowser);
    setBrowserProfile(initialBrowserProfile ?? "");
    setError(null);
    setBusy(false);
    setReopening(false);
    setSucceeded(false);
    setCopied(false);
    setManualUrl(false);
  }, [initialBrowser, initialBrowserProfile, connectionName, forceRestart]);

  useEffect(() => {
    if (!succeeded) return;
    const timer = setTimeout(onSuccess, 1200);
    return () => clearTimeout(timer);
  }, [succeeded, onSuccess]);

  const cancel = async () => {
    try {
      await onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startAuth = async (openBrowser: boolean) => {
    setAuthSessionKey(crypto.randomUUID());
    setCopied(false);
    setManualUrl(!openBrowser);
    setBusy(true);
    setError(null);
    try {
      await onConfirm({
        oidcBrowser: browser,
        oidcBrowserProfile: browserProfile.trim() || null,
        forceRestart,
        openBrowser,
      });
      setSucceeded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !succeeded) void cancel();
      }}
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex-1">
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Authenticate "{connectionName}" in a browser
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {message ?? (
                <>
                  This connection needs to authenticate using a browser before Mango
                  can connect.
                </>
              )}
            </div>
          </div>
          {!succeeded && <button
            type="button"
            onClick={() => void cancel()}
            className="btn-icon btn-ghost"
            title="Cancel authentication"
          >
            <IconX size={16} />
          </button>}
        </header>

        <div className="space-y-4 px-5 py-4">
          {!busy && !succeeded && <div>
            <div className="mb-2 eyebrow">
              Browser
            </div>
            <BrowserPicker
              browsers={browserOptions.data?.browsers ?? []}
              browser={browser}
              browserProfile={browserProfile}
              onBrowserChange={setBrowser}
              onBrowserProfileChange={setBrowserProfile}
              includeSystemDefault
            />
          </div>}

          {succeeded ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center" role="status">
              <IconCheck size={36} className="text-emerald-600 dark:text-emerald-400" />
              <div className="font-medium text-slate-900 dark:text-slate-100">Authentication successful</div>
            </div>
          ) : busy ? (
            <div className="flex flex-col items-center gap-4 py-5 text-center">
              <div className="relative">
                {browser ? (
                  <img
                    src={withBase(`/assets/browser/${browser}.svg`)}
                    alt=""
                    className="h-16 w-16 rounded-2xl bg-white object-contain p-2 dark:bg-slate-800"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                    <IconDeviceDesktop size={30} className="text-slate-500 dark:text-slate-300" />
                  </div>
                )}
                <IconLoader2
                  size={20}
                  className="absolute -bottom-2 -right-2 animate-spin rounded-full bg-white p-0.5 text-sky-500 dark:bg-slate-900"
                />
              </div>
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  Browser authentication is running
                </div>
                <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {manualUrl ? "Open the auth URL in a browser to finish signing in." : <>
                    Finish signing in with {labelForOidcBrowser(browser)}
                    {browserProfile.trim() ? ` (${browserProfile.trim()})` : ""}.
                  </>}
                  Mango will reload the connection when authentication completes.
                </div>
              </div>
              {manualUrl && authUrl.data && (
                <input
                  readOnly
                  value={authUrl.data}
                  aria-label="Authorization URL"
                  onFocus={(event) => event.target.select()}
                  className="w-full rounded border border-slate-300 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                />
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {onReopen && (
                  <button
                    type="button"
                    disabled={reopening}
                    onClick={async () => {
                      setReopening(true);
                      setError(null);
                      try {
                        await onReopen({
                          oidcBrowser: browser,
                          oidcBrowserProfile: browserProfile.trim() || null,
                        });
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setReopening(false);
                      }
                    }}
                    className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {reopening ? <IconLoader2 size={14} className="animate-spin" /> : <IconExternalLink size={14} />}
                    {reopening ? "Opening…" : "Open browser again"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!authUrl.data}
                  onClick={async () => {
                    if (!authUrl.data) return;
                    try {
                      await navigator.clipboard.writeText(authUrl.data);
                      setCopied(true);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                  className="btn btn-outline disabled:opacity-50"
                >
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  {copied ? "Copied" : "Copy auth URL"}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
              Selected browser:{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {labelForOidcBrowser(browser)}
              </span>
              {browserProfile.trim() ? ` (${browserProfile.trim()})` : ""}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
          {!succeeded && <button
            type="button"
            onClick={() => void cancel()}
            className="btn btn-outline"
          >
            Cancel
          </button>}
          {!busy && <button
            type="button"
            onClick={() => void startAuth(false)}
            className="btn btn-outline"
          >
            Get URL
          </button>}
          {!busy && <button
            type="button"
            onClick={() => void startAuth(true)}
            className="btn btn-primary"
          >
            {confirmLabel}
          </button>}
        </footer>
      </div>
    </div>
  );
};
