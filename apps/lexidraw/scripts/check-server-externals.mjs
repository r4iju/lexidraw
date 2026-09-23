// Vercel's Node 24 functions run with require(esm) disabled. Packages that
// Next keeps external (not bundled by Turbopack) are therefore loaded with a
// plain CommonJS require() at runtime, and any ESM-only module in their
// dependency graph crashes the function with ERR_REQUIRE_ESM. That took the
// dashboard down when jsdom pulled in an ESM-only encoding library. This check
// loads each external the same way the function will, so a bad bump fails the
// build instead of production.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Externals that ship as CommonJS and are loaded on the server. Add a package
// here when it lands in `serverExternalPackages` or Next's default external
// list and is imported from server code.
const SERVER_EXTERNALS = ["jsdom"];

let failed = false;
for (const name of SERVER_EXTERNALS) {
  const entry = require.resolve(name);
  const result = spawnSync(
    process.execPath,
    [
      "--no-experimental-require-module",
      "-e",
      "require(process.argv[1])",
      entry,
    ],
    { encoding: "utf8" },
  );
  if (result.status === 0) {
    console.log(`[check-server-externals] ${name}: loads without require(esm)`);
    continue;
  }
  failed = true;
  console.error(
    `[check-server-externals] ${name} needs require(esm), which Vercel functions do not provide:\n${result.stderr}`,
  );
}

process.exit(failed ? 1 : 0);
