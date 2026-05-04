---
name: mango-release
description: Cut a new Mango release. Bumps the version in every file that tracks it, opens a release-branch PR, then (after merge) tags and pushes — the desktop-build workflow takes the tag and publishes a GitHub Release with the .dmg/.msi/.deb artifacts. Use when the user asks to "release X.Y.Z", "cut a release", "create release X.Y.Z", or "ship X.Y.Z".
---

# Mango release

Mango ships as Aspire/Docker/desktop from one repo. A release is "bump versions, merge to main, push a tag" — the `desktop-build.yml` workflow takes the tag and builds + publishes the GitHub Release.

## Inputs

- The new version `X.Y.Z` (plain SemVer, no `v` prefix). Pre-releases use a dash suffix (e.g. `0.4.0-beta.1`) and the workflow auto-marks them as prerelease.

## Files to bump (ALL of them)

The version lives in seven places. Miss one and the desktop bundle's `Info.plist` / installer ends up reporting the old version even though git says the new one. Always bump them all to the same value:

1. `package.json` — root workspace
2. `ui/package.json`
3. `server/package.json`
4. `desktop/package.json`
5. `desktop/src-tauri/tauri.conf.json` — `"version"` field
6. `desktop/src-tauri/Cargo.toml` — `version = "..."` under `[package]`
7. `desktop/src-tauri/Cargo.lock` — find `name = "mango-desktop"` and update the `version` line right after it (this entry is tracked in git)

## Procedure

```bash
# 1. Verify clean working tree, on main, up to date
git status                       # must be clean
git checkout main
git pull --ff-only origin main
```

```bash
# 2. Bump the seven files to the new version (use the Edit tool, one per file)
#    — confirm with: grep -nE '"version"|^version' across the files above
```

```bash
# 3. Run sanity checks before committing
yarn workspace @mango/server test       # 20+ tests
yarn workspace @mango/ui typecheck      # silent on success
yarn workspace @mango/server tsc --noEmit
```

```bash
# 4. Commit on a release branch — main is protected by a hook that
#    refuses direct pushes of release commits.
git checkout -b release/X.Y.Z
git add -A
git commit -m "release: X.Y.Z

<short bullet summary of major changes since the previous release —
group by area: providers, UI, server, desktop, etc. Keep it skimmable.>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push -u origin release/X.Y.Z
```

```bash
# 5. Open the PR. Title is "release: X.Y.Z". Body should include a Summary
#    section and a Test plan checklist (sample below).
gh pr create --base main --head release/X.Y.Z \
  --title "release: X.Y.Z" \
  --body "<see PR body template below>"
```

**STOP and report the PR URL to the user.** Do not tag yet — the user merges the PR via the normal review flow. Only after they confirm the merge:

```bash
# 6. Pull the merge commit to local main
git checkout main
git pull --ff-only origin main

# 7. Tag and push. The tag name is plain SemVer with NO `v` prefix —
#    desktop-build.yml only matches tags like 0.3.1, not v0.3.1.
git tag -a X.Y.Z -m "Mango X.Y.Z"
git push origin X.Y.Z

# 8. Watch the build (matrix: macos-arm64 dmg+app, ubuntu-22.04 deb,
#    windows-latest msi+nsis). Past releases run ~10 min.
gh run list --workflow=desktop-build.yml --limit 1
gh run watch <run-id> --exit-status

# 9. Verify the release was published with all assets
gh release view X.Y.Z
```

If the workflow fails partway, the release will exist but be missing assets. Re-run only the failed matrix job via `gh run rerun <run-id> --failed` — don't re-tag.

## PR body template

```markdown
## Summary

- <bullet 1 — one line per major change area>
- <bullet 2>
- <bullet 3>

## Test plan

- [ ] `yarn install && yarn workspace @mango/server test`
- [ ] `yarn workspace @mango/ui typecheck` clean
- [ ] `yarn compile-server && yarn tauri:dev` — sidecar boots
- [ ] <feature-specific manual checks>
- [ ] Tag `X.Y.Z` push triggers `desktop-build.yml` to publish artifacts

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Failure modes

- **`git push origin main` blocked** — expected. The repo has a hook that rejects direct release pushes to main. Always go via PR.
- **Workflow doesn't trigger after `git push origin X.Y.Z`** — verify the tag matches the regex `[0-9]+.[0-9]+.[0-9]+*`. A `v` prefix is the usual culprit.
- **macOS sidecar builds but fails to launch on the user's machine** — separate issue, see `desktop/scripts/compile-server.mjs` (ad-hoc codesign step). Not a release-process problem.
- **`Cargo.lock` shows other packages bumping when you only touched `mango-desktop`** — fine, that's `cargo` re-resolving. Stage everything.

## What this skill does NOT do

- Update CHANGELOG / docs site / release notes on philbir.github.io — those aren't part of the release flow today.
- Bump the Aspire NuGet package — `nuget-publish.yml` is a separate workflow.
- Build the Docker image — `docker-publish.yml` is separate.

If the user asks for any of those, treat it as a follow-up, not a step inside this skill.
