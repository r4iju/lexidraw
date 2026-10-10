import { expect, test } from "bun:test";

test("authenticated autocomplete preserves access, streamed output and provider errors", async () => {
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
  expect(stdout).toContain(
    "authenticated autocomplete retains its streamed response",
  );
});
