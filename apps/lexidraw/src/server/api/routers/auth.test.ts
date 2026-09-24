/// <reference types="bun" />
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { authRouter } = await import("./auth");

const caller = authRouter.createCaller({
  drizzle: db,
  schema,
  session: null,
  auth: { kind: "session" },
  headers: new Headers(),
} as never);

const signUp = {
  name: "Signup",
  email: "signup@example.test",
  password: "Correct-Horse-Battery-9!",
};

afterEach(() => {
  mock.restore();
});

describe("sign-up", () => {
  test("stores the password as scrypt", async () => {
    await caller.signUp(signUp);

    const [row] = await db
      .select({ password: schema.users.password })
      .from(schema.users)
      .where(eq(schema.users.email, signUp.email));
    expect(row?.password).toStartWith("scrypt$");
  });

  test("a duplicate email fails without logging the new hash", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});

    await expect(caller.signUp(signUp)).rejects.toThrow("Something went wrong");

    const logged = error.mock.calls.map((args) => Bun.inspect(args)).join("\n");
    expect(logged).not.toContain("scrypt$");
    expect(logged).toContain("[Auth]");
  });
});
