import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(
  new URL("../../../../test/run-bucket-cleanup-cron.ts", import.meta.url),
);

test.each([
  ["initialization", "Error"],
  ["cleanup", "SQLITE_BUSY"],
])(
  "reports safe generated-image %s failures and still starts the workflow",
  (phase, error) => {
    // Keep the route's module mocks out of the main Bun test process.
    const result = Bun.spawnSync([process.execPath, fixture, phase]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      calls: [
        [
          "[Vercel Blob Cleanup] Generated image cleanup failed",
          { phase, error },
        ],
      ],
      status: 200,
      starts: 1,
    });
  },
);
