import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(
  new URL("../../../../test/run-bucket-cleanup-cron.ts", import.meta.url),
);

function runCron(mode: string) {
  // Keep the route's module mocks out of the main Bun test process.
  const result = Bun.spawnSync([process.execPath, fixture, mode]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString());
}

test("skips unconfigured generated image cleanup and still starts the workflow", () => {
  expect(runCron("unconfigured")).toEqual({
    calls: [],
    info: [
      [
        "[Vercel Blob Cleanup] Generated image cleanup skipped: private image storage is not configured",
      ],
    ],
    imageInitializations: 0,
    status: 200,
    starts: 1,
  });
});

test.each([
  ["initialization", "Error"],
  ["cleanup", "SQLITE_BUSY"],
])(
  "reports safe generated-image %s failures and still starts the workflow",
  (phase, error) => {
    expect(runCron(phase)).toEqual({
      calls: [
        [
          "[Vercel Blob Cleanup] Generated image cleanup failed",
          { phase, error },
        ],
      ],
      info: [],
      imageInitializations: 1,
      status: 200,
      starts: 1,
    });
  },
);
