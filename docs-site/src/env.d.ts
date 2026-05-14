/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MANGO_VERSION?: string;
  readonly VITE_MANGO_REPO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
