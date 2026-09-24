/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { firstWord, normalizeCompletion, typedThrough } from "./completion";

describe("normalizeCompletion", () => {
  test("drops the leading space when the user already typed one", () => {
    expect(normalizeCompletion("visit the ", " temple gates.")).toBe(
      "temple gates.",
    );
  });

  test("keeps the space the model gives to start a new word", () => {
    expect(normalizeCompletion("reduce churn by", " 15% this year.")).toBe(
      " 15% this year.",
    );
  });

  test("finishes a word without a space", () => {
    expect(normalizeCompletion("a new programming langu", "age is")).toBe(
      "age is",
    );
  });

  test("adds the space a new word needs after punctuation", () => {
    expect(normalizeCompletion("Dear Anna,", "thanks for")).toBe(" thanks for");
  });

  test("adds the space a new sentence needs after a full stop", () => {
    expect(normalizeCompletion("support bottlenecks.", "We will track")).toBe(
      " We will track",
    );
  });

  test("adds no space inside a name with a dot", () => {
    expect(normalizeCompletion("see example.", "com for")).toBe("com for");
  });

  test("adds no space after punctuation in scripts without spaces", () => {
    expect(normalizeCompletion("雨が降っていたので、", "家で過ごした。")).toBe(
      "家で過ごした。",
    );
  });

  test("stops at the end of the line", () => {
    expect(normalizeCompletion("We met on ", "Tuesday.\n\nNext day")).toBe(
      "Tuesday.",
    );
  });

  test("drops words the model repeats from before the cursor", () => {
    expect(
      normalizeCompletion(
        "Thank you for your email regarding",
        " regarding the proposal.",
      ),
    ).toBe(" the proposal.");
    expect(
      normalizeCompletion(
        "今日は雨が降っていたので、",
        "今日は雨が降っていたので、家にいた。",
      ),
    ).toBe("家にいた。");
  });

  test("keeps a word that only happens to follow the same word", () => {
    expect(normalizeCompletion("I said that", " that was fine.")).toBe(
      " that was fine.",
    );
  });

  test("returns nothing for a whitespace-only reply", () => {
    expect(normalizeCompletion("Hello ", "  \n")).toBe("");
  });
});

describe("typedThrough", () => {
  const shown = { prefix: "reduce churn by", suggestion: " 15% this year." };

  test("keeps the rest of the suggestion while the user types it", () => {
    expect(typedThrough(shown, "reduce churn by 1")).toBe("5% this year.");
  });

  test("keeps the whole suggestion while nothing changed", () => {
    expect(typedThrough(shown, "reduce churn by")).toBe(" 15% this year.");
  });

  test("gives up once the user types something else", () => {
    expect(typedThrough(shown, "reduce churn by 2")).toBeNull();
  });

  test("gives up once the suggestion is fully typed", () => {
    expect(typedThrough(shown, "reduce churn by 15% this year.")).toBeNull();
  });

  test("gives up when the user deletes before the suggestion", () => {
    expect(typedThrough(shown, "reduce churn b")).toBeNull();
  });
});

describe("firstWord", () => {
  test("takes the next word with its leading space", () => {
    expect(firstWord(" 15% this year.")).toBe(" 15%");
  });

  test("takes the rest of a word being finished", () => {
    expect(firstWord("age is to build")).toBe("age");
  });

  test("takes the whole suggestion when it is one word", () => {
    expect(firstWord("flour")).toBe("flour");
  });

  test("takes one character of text without spaces", () => {
    expect(firstWord("家で過ごした。")).toBe("家");
  });
});
