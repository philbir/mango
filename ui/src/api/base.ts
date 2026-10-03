// URL prefix when Mango is served under a reverse-proxy path (MANGO_BASE_PATH),
// injected into index.html by the server. Undefined under Vite dev and the
// desktop shell's bundled origin, where the app always lives at "/".
const BASE: string =
  (window as unknown as { __MANGO_BASE__?: string }).__MANGO_BASE__ ?? "";

/** Prefix an absolute app path ("/api/x", "/assets/y") with the base path. */
export const withBase = (path: string): string => `${BASE}${path}`;
