---
name: mango-release
description: Cut a new Mango release. The git tag is the version — push a plain-SemVer tag on main and CI stamps it into every versioned file, builds the desktop bundles, publishes the GitHub Release, the Docker image and the NuGet package; then set the release notes. Use when the user asks to "release X.Y.Z", "cut a release", "create release X.Y.Z", or "ship X.Y.Z".
---

# Mango release

Mango ships as Aspire/Docker/desktop from one repo. **The tag is the version.** The repo holds `0.0.0-dev` in every versioned file; each tag-triggered workflow runs `node scripts/set-version.mjs "$GITHUB_REF_NAME"` right after checkout, so there is no version-bump PR.

Tag pushes trigger:
- `desktop-build.yml` — macOS arm64 (.dmg/.app), Linux (.deb/.AppImage), Windows (.msi/NSIS) + updater `latest.json`; creates the GitHub Release.
- `docker-publish.yml` — `ghcr.io/philbir/mango:<version>` (+ `latest` for non-prereleases).
- `nuget-publish.yml` — `Mango.Aspire.Hosting` at the tag version.

## Inputs

- The new version `X.Y.Z` (plain SemVer, **no `v` prefix** — the workflows only match `[0-9]+.[0-9]+.[0-9]+*`). Pre-releases use a dash suffix (`0.6.0-beta.1`) and are auto-marked prerelease; Windows builds NSIS only for them (MSI rejects non-numeric pre-release versions).

## Procedure

```bash
# 1. Main must be clean, current, and contain everything that ships.
git status
git checkout main
git pull --ff-only origin main
git tag --sort=-v:refname | head -3      # previous release, for the notes
```

```bash
# 2. Sanity checks on exactly what will be tagged.
pnpm install --frozen-lockfile              # CI runs this — a lockfile/overrides drift fails every job
pnpm --filter @mango/server test
pnpm --filter @mango/ui typecheck
pnpm --filter @mango/server exec tsc --noEmit
pnpm compile-server && ./desktop/bin/mango-server-* & sleep 2; curl -sf localhost:5180/api/health; kill %1
#   ^ the compiled sidecar must boot — a Bun incompatibility here ships a dead desktop app.
```

```bash
# 3. Tag and push.
git tag -a X.Y.Z -m "Mango X.Y.Z"
git push origin X.Y.Z
```

```bash
# 4. Watch the desktop build (~10 min).
gh run list --workflow=desktop-build.yml --limit 1
gh run watch <run-id> --exit-status
```

```bash
# 5. Write the release notes — tauri-action creates the release with a
#    placeholder body. Summarise `git log <prev>..X.Y.Z`, grouped by area
#    (desktop, UI, server, providers, Aspire, docs), user-facing language.
gh release edit X.Y.Z --notes-file notes.md
gh release view X.Y.Z                     # verify notes + all assets
```

The updater's `latest.json` embeds the notes at publish time; if they were edited afterwards, re-run the `publish-updater` job (`gh run rerun <run-id> --job <id>`) so the in-app update dialog shows them.

## Failure modes

- **`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` in every job** — `pnpm-lock.yaml` lost its `overrides:` block (the root `package.json` `pnpm.overrides`; a tool regenerated the lockfile). Fix on a branch with `pnpm install`, merge, then re-tag (below). The PR `CI` workflow and `server/test/lockfile.test.ts` should catch this before it reaches main.
- **Build failed before publishing anything** (no release, updater job skipped) — fix on main, then move the tag: `git tag -d X.Y.Z && git push origin :refs/tags/X.Y.Z`, re-tag the new main commit, push. Confirm with the user first; never move a tag whose release was published.
- **A matrix job failed after the release exists** — `gh run rerun <run-id> --failed`; don't re-tag.
- **Workflow doesn't trigger** — tag has a `v` prefix, or was pushed as lightweight from a detached commit not on main.
- **macOS sidecar builds but fails to launch** — see `desktop/scripts/compile-server.mjs` (ad-hoc codesign) and `server/src/bun-compat.ts` (Bun runtime shims). The app now shows the sidecar's exit reason and last log lines on its error screen.

## What this skill does NOT do

- Update the docs site / CHANGELOG — `pages.yml` deploys docs separately.
- Local `pnpm tauri:build` versions: run `node scripts/set-version.mjs X.Y.Z` first if you need a locally built bundle to carry a real version, and don't commit the result.
