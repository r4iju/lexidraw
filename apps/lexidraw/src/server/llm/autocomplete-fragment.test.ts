/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { fragmentAt, stripFragment } from "./autocomplete-fragment";

async function through(fragment: string, chunks: string[]): Promise<string> {
  const stream = new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }).pipeThrough(stripFragment(fragment));
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}

describe("fragmentAt", () => {
  test("is the word the cursor is in", () => {
    expect(fragmentAt("a new programming langu")).toBe("langu");
  });

  test("is a whole word the user may still extend", () => {
    expect(fragmentAt("reduce churn by")).toBe("by");
  });

  test("keeps punctuation typed after the word", () => {
    expect(fragmentAt("Dear Anna,")).toBe("Anna,");
  });

  test("is empty after a space", () => {
    expect(fragmentAt("## Ingredients\n- 2 cups of ")).toBe("");
  });

  test("is empty in scripts without spaces", () => {
    expect(fragmentAt("今日は雨が降っていたので、")).toBe("");
  });
});

describe("stripFragment", () => {
  test("drops the fragment the model repeats, keeping its space", async () => {
    expect(await through("by", ["b", "y 15", "% this year."])).toBe(
      " 15% this year.",
    );
  });

  test("leaves the rest of a word being finished", async () => {
    expect(await through("langu", ["language is"])).toBe("age is");
  });

  test("passes text through when the model does not repeat", async () => {
    expect(await through("the", [" testing phase"])).toBe(" testing phase");
  });

  test("passes text through when there is no fragment", async () => {
    expect(await through("", ["temples"])).toBe("temples");
  });

  test("returns nothing when the model only repeats the fragment", async () => {
    expect(await through("langu", ["lan", "gu"])).toBe("");
  });
});
