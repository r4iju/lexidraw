# Agent instructions

## Project runner

This project runs in the project runner: run installs, builds, tests, dev
servers and package scripts through `prun`, never directly on the Mac.

- Install: `prun bun install --frozen-lockfile`. No dependency install
  script is needed.
- The runner sets `TURBO_CACHE_DIR=.turbo/cache`, so root turbo scripts
  cache inside the checkout, worktrees included. No `--cache-dir` is needed.
- Checks: `prun bun run lint`, `prun bun run test:ts`,
  `prun bun run test '--filter=!@apps/ios'`.
  The package `lint` scripts run `biome check --write`. In the container they
  rewrite files under `packages/drizzle`, so check `git status` afterwards.
- Build: `prun env VERCEL_URL=localhost bun run build`.
  `next.config.ts` needs `VERCEL_URL`, which only Vercel sets.
- Dev server: `prun --port 3025 bun run dev`, then open
  http://localhost:3025. Stop it with Ctrl-C on the `prun` process.
  Only port 3025 is published; render-html-worker (4025) is not reachable
  from the Mac.
- Browser tests: install Playwright's own browser once with
  `prun packages/drawing-widget/node_modules/.bin/playwright install chromium-headless-shell`
  (not `bun x playwright`, which fetches a newer version). The image ships
  Chromium's system libraries, and the `packages/drawing-widget` tests pass.

Known gaps (2026-10-26):

- `apps/ios` stays on the Mac: its `test` and UI scripts need Xcode, `swift`
  and simulators.
- 13 of 38 tests in `apps/render-html-worker` fail: Puppeteer's Chrome starts,
  then exits with `chrome_crashpad_handler: --database is required`.
- The full `@apps/lexidraw` test run has about 280 failures in the
  container. The files sampled pass on their own, so this looks like
  cross-file interference. It has not been compared with a run on the Mac.
- `lint` fails on two existing design-token findings in
  `apps/lexidraw/src/app/settings/`.
