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

describe("saving settings", () => {
  const SETTINGS_USER = "settings_user";
  const settings = authRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: SETTINGS_USER } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
  const account = { name: "Settings", email: "settings@example.test" };
  const stored = async () => {
    const [row] = await db
      .select({ config: schema.users.config })
      .from(schema.users)
      .where(eq(schema.users.id, SETTINGS_USER));
    // Stored overrides are partial, whatever the column's type says.
    return row?.config as
      | {
          llm?: Record<string, unknown>;
          autocomplete?: Record<string, unknown>;
        }
      | undefined;
  };

  test("keeps the agent model, and a cleared field goes back to the default", async () => {
    await db
      .insert(schema.llmPolicies)
      .values(
        (["chat", "agent", "autocomplete"] as const).map((mode) => ({
          mode,
          provider: "google",
          modelId: "gemini-3-pro-preview",
          temperature: 0.5,
          maxOutputTokens: 8000,
          allowedModels: [
            { provider: "google", modelId: "gemini-3-pro-preview" },
            { provider: "openai", modelId: "gpt-5-mini" },
          ],
          enforcedCaps: {
            maxOutputTokensByProvider: { openai: 32768, google: 65535 },
          },
        })),
      )
      .onConflictDoNothing();
    await db.insert(schema.users).values({ id: SETTINGS_USER, ...account });

    await settings.updateProfile({
      ...account,
      chat: { provider: "openai", modelId: "gpt-5-mini", temperature: 0.9 },
      agent: { provider: "openai", modelId: "gpt-5-mini" },
    });
    expect((await stored())?.llm?.agent).toEqual({
      provider: "openai",
      modelId: "gpt-5-mini",
    });

    await settings.updateProfile({ ...account, chat: { temperature: null } });
    expect((await stored())?.llm?.chat).toEqual({
      provider: "openai",
      modelId: "gpt-5-mini",
    });
  });

  test("autocomplete settings go where autocomplete reads them", async () => {
    await settings.updateProfile({
      ...account,
      autocomplete: { enabled: false, verbosity: "high" },
    });
    expect((await stored())?.autocomplete).toMatchObject({
      enabled: false,
      verbosity: "high",
    });
  });

  test("a changed email is no longer proven, an unchanged one stays proven", async () => {
    const provenAt = Date.UTC(2026, 0, 1);
    const verifiedAt = async () => {
      const [row] = await db
        .select({ emailVerified: schema.users.emailVerified })
        .from(schema.users)
        .where(eq(schema.users.id, SETTINGS_USER));
      return row?.emailVerified;
    };
    await db
      .update(schema.users)
      .set({ emailVerified: provenAt })
      .where(eq(schema.users.id, SETTINGS_USER));

    await settings.updateProfile({ ...account, name: "Renamed" });
    expect(await verifiedAt()).toBe(provenAt);

    await settings.updateProfile({ ...account, email: "moved@example.test" });
    expect(await verifiedAt()).toBeNull();
  });
});
