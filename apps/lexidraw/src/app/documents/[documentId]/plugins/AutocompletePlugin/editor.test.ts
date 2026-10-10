import { expect, test } from "bun:test";
test("actual Lexical editor preserves suggestion acceptance and supersession", async () => {
  const run = Bun.spawn(
    [process.execPath, "test", `${import.meta.dir}/editor.contract.ts`],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  expect(code, stderr).toBe(0);
  expect(stdout + stderr).toContain("4 pass");
});
