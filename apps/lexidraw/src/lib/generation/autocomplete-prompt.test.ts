import { expect, test } from "bun:test";
import { autocompletePrompt } from "./autocomplete-prompt";

for (const { name, before, after, expectedBefore, expectedAfter } of [
  {
    name: "before boundary",
    before: "😀" + "a".repeat(2999),
    after: "",
    expectedBefore: "a".repeat(2999),
    expectedAfter: "",
  },
  {
    name: "after boundary",
    before: "",
    after: "a".repeat(599) + "😀",
    expectedBefore: "",
    expectedAfter: "a".repeat(599),
  },
  {
    name: "ASCII at both limits",
    before: "z" + "a".repeat(3000),
    after: "b".repeat(600) + "z",
    expectedBefore: "a".repeat(3000),
    expectedAfter: "b".repeat(600),
  },
  {
    name: "complete emoji inside both limits",
    before: "z😀" + "a".repeat(2998),
    after: "b".repeat(598) + "😀z",
    expectedBefore: "😀" + "a".repeat(2998),
    expectedAfter: "b".repeat(598) + "😀",
  },
]) {
  test(`autocomplete context preserves Unicode and UTF-16 budgets: ${name}`, () => {
    const prompt = autocompletePrompt({ title: "Notes", before, after });
    const context = prompt.slice("Document title: Notes\n\n".length);
    const [retainedBefore, tail] = context.split("<cursor/>");
    const retainedAfter = tail.split("\n\n<fragment>")[0];
    expect(retainedBefore.length).toBeLessThanOrEqual(3000);
    expect(retainedAfter.length).toBeLessThanOrEqual(600);
    expect(retainedBefore).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(retainedAfter).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(prompt).toBe(
      `Document title: Notes\n\n${expectedBefore}<cursor/>${expectedAfter}\n\n<fragment>${before}</fragment>`,
    );
  });
}
