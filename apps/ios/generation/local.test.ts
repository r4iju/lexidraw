import { expect, test } from "bun:test";
import { prepareLocalContinuation, finishLocalContinuation } from "./local";

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

test("local UTF16 windows exclude a scalar cut by a prefix or suffix boundary", () => {
  const task = prepareLocalContinuation({
    title: `${"a".repeat(199)}😀tail`,
    before: `😀${"x".repeat(1199)}`,
    after: `${"z".repeat(299)}😀tail`,
  });
  expect(JSON.parse(JSON.stringify(task)).prompt).toBe(
    `Document title: ${"a".repeat(199)}\n\n${"x".repeat(1199)}<cursor/>${"z".repeat(299)}\n\n<fragment>${"x".repeat(1199)}</fragment>`,
  );
  expect(task.prompt).not.toMatch(/[\uD800-\uDFFF]/u);
  const exact = prepareLocalContinuation({
    title: `${"a".repeat(198)}😀`,
    before: `😀${"x".repeat(1198)}`,
    after: `${"z".repeat(298)}😀`,
  });
  expect(exact.prompt).toBe(
    `Document title: ${"a".repeat(198)}😀\n\n😀${"x".repeat(1198)}<cursor/>${"z".repeat(298)}😀\n\n<fragment>😀${"x".repeat(1198)}</fragment>`,
  );
});

test("finish uses the same scalar-safe nearest UTF16 suffix as preparation", () => {
  expect(
    finishLocalContinuation(`😀${"x".repeat(1199)}`, `${"x".repeat(1199)}done`),
  ).toBe("done");
});
