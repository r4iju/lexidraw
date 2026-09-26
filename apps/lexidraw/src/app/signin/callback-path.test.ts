import { describe, expect, test } from "bun:test";
import { callbackPath } from "./callback-path";

describe("where sign-in returns to", () => {
  test("is the page that sent the user here, query included", () => {
    expect(
      callbackPath("/native-sign-in?redirectUri=lexidraw%3A%2F%2Fauth"),
    ).toBe("/native-sign-in?redirectUri=lexidraw%3A%2F%2Fauth");
  });

  test("is the dashboard for anything that would leave the site", () => {
    for (const value of [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example/",
      "/\t/evil.example/",
      "/a/..//evil.example/",
      "javascript:alert(1)",
      undefined,
      ["/a", "/b"],
    ]) {
      expect(callbackPath(value)).toBe("/dashboard");
    }
  });
});
