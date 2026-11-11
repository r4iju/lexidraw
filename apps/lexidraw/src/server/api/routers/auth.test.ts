/// <reference types="bun" />
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { eq, sql } from "drizzle-orm";
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

describe("native social identity", () => {
  test("returns the signed-in profile name for comment authors", async () => {
    const identity = authRouter.createCaller({
      drizzle: db,
      schema,
      session: {
        user: {
          id: "native_social_user",
          email: "native@example.test",
          name: "Native Reader",
        },
      },
      auth: { kind: "session" },
      headers: new Headers(),
    } as never);
    expect(await identity.me({})).toMatchObject({
      userId: "native_social_user",
      name: "Native Reader",
    });
  });
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

  test("a registered email in any case or spacing answers a conflict and leaves the account alone", async () => {
    const [before] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, signUp.email));

    for (const email of [signUp.email, "  SignUp@Example.TEST "]) {
      await expect(
        caller.signUp({
          email,
          name: "Intruder",
          password: "Another-Horse-Battery-8!",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }

    const rows = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${signUp.email}`);
    expect(rows).toEqual([before as NonNullable<typeof before>]);
  });

  test("an account created between the check and the insert answers a conflict, logging no hash", async () => {
    const email = "signup_race@example.test";
    await db.run(
      sql.raw(`CREATE TRIGGER signup_race BEFORE INSERT ON "Users"
        WHEN NEW.email = '${email}' AND NEW.id <> 'signup_race_winner'
        BEGIN INSERT INTO "Users" (id, name, email) VALUES ('signup_race_winner', 'Winner', NEW.email); END`),
    );
    const error = spyOn(console, "error").mockImplementation(() => {});

    await expect(
      caller.signUp({ ...signUp, email, name: "Loser" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const logged = error.mock.calls.map((args) => Bun.inspect(args)).join("\n");
    expect(logged).not.toContain("scrypt$");
  });

  test("a new account's email is stored trimmed and lowercased", async () => {
    await caller.signUp({ ...signUp, email: "  New.Person@Example.TEST " });

    const rows = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(
        sql`lower(${schema.users.email}) like '%new.person@example.test%'`,
      );
    expect(rows).toEqual([{ email: "new.person@example.test" }]);
  });

  test("a sign-up missing or failing any field is refused with the form's message and creates no user", async () => {
    const valid = {
      name: "Refused",
      email: "refused@example.test",
      password: "Correct-Horse-Battery-9!",
    };
    const { email: _email, ...noEmail } = valid;
    const { name: _name, ...noName } = valid;
    const { password: _password, ...noPassword } = valid;
    const refused: [unknown, string | null][] = [
      [{}, null],
      [noEmail, null],
      [noName, null],
      [noPassword, null],
      [{ ...valid, email: "" }, "Enter your email address."],
      [{ ...valid, name: "" }, "Use at least 3 characters for your name."],
      [{ ...valid, password: "" }, "Use at least 16 characters."],
      [{ ...valid, email: "not-an-email" }, "Enter your email address."],
      [
        { ...valid, password: "correct-horse-battery-9!" },
        "Add an uppercase letter.",
      ],
    ];
    const users = async () => (await db.select().from(schema.users)).length;
    const before = await users();

    for (const [input, message] of refused) {
      const attempt = expect(caller.signUp(input as typeof valid)).rejects;
      await attempt.toMatchObject({ code: "BAD_REQUEST" });
      if (message) await attempt.toThrow(message);
    }

    expect(await users()).toBe(before);
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

  test("profile edits preserve existing legacy AI metadata and deny obsolete model changes", async () => {
    const config = {
      llm: {
        chat: {
          provider: "openai",
          modelId: "gpt-5-mini",
          temperature: 0.9,
          maxOutputTokens: 100,
        },
        agent: { provider: "openai", modelId: "gpt-5-mini" },
      },
    };
    await db
      .insert(schema.users)
      .values({ id: SETTINGS_USER, ...account, config });
    await expect(
      settings.updateProfile({ ...account, chat: { temperature: null } }),
    ).rejects.toThrow("AI Power");
    await settings.updateProfile({ ...account, name: "Renamed" });
    expect((await stored())?.llm).toEqual(config.llm);
  });
  test("only writing opt-in is saved by profile settings, preserving legacy preferences without using them", async () => {
    await settings.updateProfile({
      ...account,
      autocomplete: { enabled: false },
    });
    expect((await stored())?.autocomplete).toMatchObject({ enabled: false });
    await expect(
      settings.updateProfile({
        ...account,
        autocomplete: { verbosity: "high" },
      }),
    ).rejects.toThrow("AI Power");
  });

  test("ordinary listening speed controls update saved playback without changing the source", async () => {
    await settings.updateProfile({ ...account, tts: { speed: 1.25 } });
    const [row] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SETTINGS_USER));
    expect(row?.config?.audio?.preferredPlaybackRate).toBe(1.25);
    await settings.updateProfile({ ...account, tts: { speed: null } });
    const [reset] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SETTINGS_USER));
    expect(reset?.config?.audio?.preferredPlaybackRate).toBeUndefined();
  });

  test("a stale ordinary settings snapshot cannot overwrite a concurrent account source preference", async () => {
    await db
      .update(schema.users)
      .set({ config: { aiPower: { mode: "byok", provider: "openrouter" } } })
      .where(eq(schema.users.id, SETTINGS_USER));
    const stale = authRouter.createCaller({
      drizzle: {
        // Only the config read is stale; other reads see the database.
        select: (fields: Record<string, unknown>) =>
          "config" in fields
            ? {
                from: () => ({
                  where: () => ({
                    limit: async () => [
                      { config: { aiPower: { mode: "local" } } },
                    ],
                  }),
                }),
              }
            : db.select(fields as never),
        update: db.update.bind(db),
      },
      session: { user: { id: SETTINGS_USER } },
      headers: new Headers(),
    } as never);
    await stale.updateProfile({ ...account, name: "Concurrent profile edit" });
    const [row] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SETTINGS_USER));
    expect(row?.config?.aiPower).toEqual({
      mode: "byok",
      provider: "openrouter",
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

  test("a profile cannot take an email another account holds, in any case", async () => {
    await db.insert(schema.users).values({
      id: "settings_email_holder",
      name: "Holder",
      email: "Settings.Holder@example.test",
    });

    for (const email of [
      "settings.holder@example.test",
      "Settings.Holder@example.test",
    ])
      await expect(
        settings.updateProfile({ ...account, email }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    const [row] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, SETTINGS_USER));
    expect(row?.email).not.toMatch(/holder/i);

    await settings.updateProfile({
      ...account,
      email: "Settings.Own@example.test",
    });
    await settings.updateProfile({
      ...account,
      email: "settings.own@example.test",
    });
  });
});
