import { describe, expect, test } from "bun:test";
import { getSignInSchema } from "./schema";

describe("sign-in form", () => {
  test("accepts a password that today's sign-up policy would reject", () => {
    const parsed = getSignInSchema().safeParse({
      email: "someone@example.test",
      password: "short",
    });
    expect(parsed.success).toBe(true);
  });

  test("asks for a password when the field is empty", () => {
    const parsed = getSignInSchema().safeParse({
      email: "someone@example.test",
      password: "",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
      "Enter your password.",
    ]);
  });
});
