// Serving Mango under a URL prefix (MANGO_BASE_PATH), for reverse proxies
// that host several tools on one origin (`https://host/mongo/`). The proxy
// forwards the full path unchanged; we mount every route under the prefix and
// tell the UI about it by injecting `<base href>` + `window.__MANGO_BASE__`
// into index.html. Read at runtime so one published image works under any
// prefix.

import { Hono } from "hono";

/**
 * Normalise a base path: leading slash, no trailing slash. Unset, empty or
 * "/" mean root and return "". Throws on values that can't be a plain path
 * prefix, so a typo fails at boot instead of serving a half-broken UI.
 */
export const normalizeBasePath = (raw: string | undefined): string => {
  const value = (raw ?? "").trim();
  if (/[?#\\]/.test(value) || value.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new Error(`MANGO_BASE_PATH must be a plain path like "/mongo", got ${JSON.stringify(raw)}`);
  }
  const trimmed = value.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  return trimmed ? `/${trimmed}` : "";
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * Put `<base href>` and `window.__MANGO_BASE__` at the top of `<head>`, ahead
 * of the bundle's relative `./assets/...` script and stylesheet tags.
 */
export const injectBasePath = (html: string, basePath: string): string => {
  // JSON.stringify for the JS string, then escape `<` so a value can never
  // close the script element; the attribute gets regular HTML escaping.
  const jsValue = JSON.stringify(basePath).replace(/</g, "\\u003c");
  const tags =
    `<base href="${escapeHtml(`${basePath}/`)}">` +
    `<script>window.__MANGO_BASE__ = ${jsValue};</script>`;
  const head = /<head[^>]*>/i.exec(html);
  if (!head) return tags + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + tags + html.slice(at);
};

/**
 * Mount `app` under `basePath`. At root it is returned as-is. Otherwise the
 * bare prefix redirects to the trailing-slash form (so relative URLs resolve
 * inside the prefix) and anything outside the prefix is a 404.
 */
export const mountAtBasePath = (app: Hono, basePath: string): Hono => {
  if (!basePath) return app;
  const root = new Hono();
  root.get(basePath, (c) => {
    const url = new URL(c.req.url);
    return c.redirect(`${basePath}/${url.search}`, 301);
  });
  root.route(basePath, app);
  return root;
};
