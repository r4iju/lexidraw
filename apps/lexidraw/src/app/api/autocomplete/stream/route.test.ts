import { expect, test } from "bun:test";

test("legacy autocomplete cannot bypass the authenticated operation boundary", async () => {
  // Other UI suites replace Next exports process-wide; the real route needs its own runtime.
  const result = Bun.spawn(
    [process.execPath, `${import.meta.dir}/route.contract.ts`],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
    result.exited,
  ]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  expect(stdout).toContain("legacy autocomplete system-key route is closed");
});
