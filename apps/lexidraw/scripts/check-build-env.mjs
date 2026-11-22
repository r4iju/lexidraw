import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const build = fileURLToPath(new URL("./build.mjs", import.meta.url));
const manifest = JSON.parse(
  readFileSync(new URL("../../../.delivery.json", import.meta.url), "utf8"),
);
const productionHostname = new URL(manifest.productionUrls[0]).hostname;

function buildWith(t, { runner = true, hostname, mountedHostname } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lexidraw-build-test-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const appEnv = join(dir, "apps", "lexidraw");
  mkdirSync(appEnv, { recursive: true });
  writeFileSync(
    join(appEnv, ".env.production"),
    mountedHostname
      ? `VERCEL_URL=${mountedHostname}\n`
      : "NODE_ENV=production\n",
  );
  writeFileSync(join(dir, "next"), '#!/bin/sh\nprintf "%s" "$VERCEL_URL"\n', {
    mode: 0o700,
  });

  const result = spawnSync(process.execPath, [build], {
    cwd: appEnv,
    env: {
      PATH: dir,
      ...(runner && { PRUN_ENV_DIR: dir }),
      ...(hostname !== undefined && { VERCEL_URL: hostname }),
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("runner builds use the Delivery hostname when Vercel did not set one", (t) => {
  assert.equal(buildWith(t), productionHostname);
});

test("runner builds preserve an explicitly provided hostname", (t) => {
  assert.equal(
    buildWith(t, { hostname: "deployment.example.test" }),
    "deployment.example.test",
  );
});

test("runner builds preserve a mounted hostname", (t) => {
  assert.equal(
    buildWith(t, { mountedHostname: "mounted.example.test" }),
    "mounted.example.test",
  );
});

test("plain builds leave hostname selection to the caller", (t) => {
  assert.equal(buildWith(t, { runner: false }), "");
  assert.equal(
    buildWith(t, { runner: false, hostname: "localhost" }),
    "localhost",
  );
});
