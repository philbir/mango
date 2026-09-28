# Mango Docs Site

Landing page and product docs for Mango, built with Vite + React. It follows the
design of the Tap docs site (`philbir/tap/docs-site`) — same layout, components,
and ArbIQ design tokens, recoloured to Mango violet.

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

The GitHub Pages workflow publishes `docs-site/dist` on pushes to `main` that
touch the docs site, workflow, root package manifest, or lockfile. The Vite config
uses `base: "./"` so the build works under `https://philbir.github.io/mango/`.

## Structure

Five pages behind a hash router — hash rather than history, because GitHub Pages
serves static files and cannot rewrite unknown paths back to `index.html`.

| Route | Page | Source |
|---|---|---|
| `#/` | Overview: hero with the platform-aware download, screenshot tour, the free-forever promise, pricing, what's included, what ships | `src/pages/home.tsx` |
| `#/features` | Workbench: browser, query builder, editing, console, shell, workspaces, notebooks, indexes, stats, import/export, GridFS, connections, auth, preferences, shortcuts | `src/pages/features.tsx` |
| `#/ai` | Mango AI: the assistant, filters, commands, index advice, providers, what the model sees | `src/pages/ai.tsx` |
| `#/guide` | Guide: desktop, Aspire, Docker, run modes, configuration, storage, telemetry, security | `src/pages/guide.tsx` |
| `#/download` | Every published artifact, with direct links into the latest release | `src/pages/download.tsx` |

A section is a second segment: `#/features/console`, `#/ai/providers`. Bare
`#section-id` links from the previous one-page site map onto their new route via
`legacyAnchors` in `src/site.ts`.

- `src/site.ts` — the page registry. Each page declares its rail nav; add a section
  here *and* give the rendered block a matching `id`, or the link goes nowhere.
- `src/router.ts` — hash parsing, scroll-on-navigate, and the scrollspy.
- `src/components/Shell.tsx` — header (brand, page switcher, Pricing, Download,
  GitHub) and the left rail, which becomes a Contents drawer below 1080px.
- `src/components/ui.tsx` — shared blocks (`CodeBlock`, `ConfigTable`, `ModeGrid`,
  `ShotFeature`, `ShipGroupCard`, …). Doc sections are data: a `DocSection` carries
  its own `content()`, and `DocList` renders the array.
- `src/components/DownloadButton.tsx` — the "Download for <platform>" button used
  by the home hero and the download page.
- `src/components/icons.tsx` — inlined brand marks (Docker, NuGet, Apple, Windows,
  Tux, GitHub) and the page glyphs; no icon package dependency.
- `src/data/release.ts` + `src/data/downloads.ts` — the download links. Release
  asset names carry the version (`Mango_0.4.1_aarch64.dmg`), so `release.ts` reads
  `/releases/latest` from the GitHub API once per session and `downloads.ts` matches
  assets by pattern. Every link falls back to the release page. Change an asset
  name in `.github/workflows/desktop-build.yml` and the pattern moves with it.
- `src/data/shipped.ts` — the reader-facing copy of what the release workflows
  publish (desktop, Docker, NuGet). Keep it in step with `.github/workflows/`.

Styling is one stylesheet (`src/styles.css`); Mango-specific additions are at the
end under `mango:` headings.

## Screenshots

`public/screenshots/` is captured from a running Mango in the light theme at
1440×900 @2x, downscaled to 2160px wide and quantised with `pngquant`. The demo
data is a seeded `shop` database (customers, orders, products, events, and a
GridFS `assets` bucket), and the AI shots are real answers from the Claude Code
provider. When the UI changes, recapture them the same way so every shot shares
one data set and theme.
