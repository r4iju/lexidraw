import { expect, test } from "bun:test";
import { PowerPreferenceSchema } from "./preference";
test("account preferences allow only non-secret power identity and keep Pro inaccessible", () => {
  expect(
    PowerPreferenceSchema.parse({ mode: "byok", provider: "openrouter" }),
  ).toEqual({ mode: "byok", provider: "openrouter" });
  for (const value of [
    { mode: "pro" },
    { mode: "byok", provider: "openai" },
    { mode: "byok", provider: "openrouter", key: "secret" },
    { mode: "local", apiKey: "secret" },
  ]) {
    expect(PowerPreferenceSchema.safeParse(value).success).toBe(false);
  }
});
