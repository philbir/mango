interface ImportMetaEnv {
  readonly VITE_MANGO_VERSION?: string;
  readonly VITE_MANGO_DOCS_URL?: string;
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
