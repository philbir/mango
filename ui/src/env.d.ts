interface ImportMetaEnv {
  readonly VITE_MANGO_VERSION?: string;
  readonly VITE_MANGO_DOCS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
