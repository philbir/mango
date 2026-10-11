# End-to-end tests

Playwright suite that drives the real UI against the real server and a real
MongoDB. It covers the collection tab (listing, filtering, drawer edit and
delete, batch update and delete) and the JavaScript console (editable
`find()` results, batch operations, and the read-only cases: aggregations,
`.map()`, projections without `_id`, `.toArray()`).

```bash
pnpm e2e:install   # once: download Chromium
pnpm e2e           # run headless
pnpm e2e:ui        # Playwright's UI mode
pnpm --filter @mango/e2e report   # open the last HTML report
```

`scripts/stack.ts` brings everything up for the run: MongoDB, the server
(`tsx src/index.ts` in standalone mode on a throwaway data dir) and the Vite
UI, on ports 5190 / 5191. With nothing configured it starts
`mongodb-memory-server` on port 27317 (the binary is downloaded on first
use). Point `MANGO_E2E_MONGO_URL` at an existing instance to skip that —
CI uses a `mongo` service container.

Tests seed the `mango_e2e` and `mango_e2e_other` databases before each test
and assert on the database directly through the driver, so they never touch
other data on the instance. They run serially for that reason.

Monaco editors are filled through the clipboard (`ControlOrMeta+A`, write
clipboard, `ControlOrMeta+V`): typing or `insertText` triggers bracket
auto-closing and leaves stray closers behind. The config grants clipboard
permissions and uses the host user agent so Monaco's shortcuts match.
