import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

if (process.env.PRUN_ENV_DIR) {
  // The runner masks checkout env files so the Vercel builder cannot bundle
  // them. Load the app's production env into the build process only.
  const envDir = join(process.env.PRUN_ENV_DIR, "apps", "lexidraw");
  const require = createRequire(import.meta.url);
  const nextRequire = createRequire(require.resolve("next/package.json"));
  const { loadEnvConfig } = nextRequire("@next/env");

  for (const key of Object.keys(process.env)) {
    if (process.env[key] === "[SENSITIVE]") delete process.env[key];
  }

  const { loadedEnvFiles } = loadEnvConfig(envDir, false);
  if (loadedEnvFiles.length === 0) {
    console.error(
      "build: no production env files in the runner's Lexidraw env directory",
    );
    process.exit(1);
  }

  for (const key of Object.keys(process.env)) {
    if (process.env[key] === "[SENSITIVE]") delete process.env[key];
  }

  // Vercel's local builder has no generated deployment hostname.
  if (process.env.VERCEL_URL === undefined) {
    const delivery = JSON.parse(
      readFileSync(new URL("../../../.delivery.json", import.meta.url), "utf8"),
    );
    process.env.VERCEL_URL = new URL(delivery.productionUrls[0]).hostname;
  }
}

const result = spawnSync(
  "next",
  ["build", "--turbopack", ...process.argv.slice(2)],
  {
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
