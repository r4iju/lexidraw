import { expect, test } from "bun:test";
import { prepareLocalContinuation } from "./local";

test("local continuation is a bounded neutral task without cloud routing or secrets", () => {
  const task = prepareLocalContinuation({
    title: "a".repeat(4000),
    before: `${"x".repeat(5000)} sun`,
    after: "z".repeat(4000),
  });
  expect(Object.keys(task).sort()).toEqual([
    "maximumResponseTokens",
    "prompt",
    "system",
  ]);
  expect(task.maximumResponseTokens).toBe(32);
  expect(task.prompt).toContain("<fragment>sun</fragment>");
  expect(task.prompt).toContain("<cursor/>");
  expect(task.prompt.length).toBeLessThan(1800);
});
