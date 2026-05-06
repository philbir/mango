interface ImportMetaEnv {
  readonly VITE_MANGO_VERSION?: string;
  readonly VITE_MANGO_DOCS_URL?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_OTEL_ENABLED?: string;
  readonly VITE_OTEL_SERVICE_NAME?: string;
  readonly VITE_OTEL_COLLECTOR_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
