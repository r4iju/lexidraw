/// <reference types="bun" />
import { expect, test } from "bun:test";
import { modelLabel } from "./model-label";

test("model ids read the way people say them", () => {
  expect(modelLabel("gemini-3-pro-preview")).toBe("Gemini 3 Pro");
  expect(modelLabel("gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
  expect(modelLabel("gpt-5-mini")).toBe("GPT-5 mini");
  expect(modelLabel("gpt-5.2")).toBe("GPT-5.2");
  expect(modelLabel("some-new-model")).toBe("some-new-model");
});
