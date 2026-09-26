/// <reference types="bun" />
import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { sessionToken } = await import("./session-token");

const USER = "stoken_user";
const CHAT = {
  modelId: "gpt-5-mini",
  provider: "openai",
  temperature: 0.5,
  maxOutputTokens: 8000,
};

beforeAll(async () => {
  await db.insert(schema.users).values({
    id: USER,
    name: "Ada Lovelace",
    email: "ada-stoken@example.test",
    config: {
      autoSave: { enabled: false },
      llm: { chat: CHAT },
    },
  });
});

const signedIn = {
  sub: USER,
  name: "Ada",
  email: "ada-stoken@example.test",
  config: {
    autoSave: { enabled: true },
    llm: { chat: { modelId: "gemini-3-pro-preview", provider: "google" } },
  },
};

describe("the session after settings are saved", () => {
  test("carries the settings as they are stored", async () => {
    const token = await sessionToken(db, {
      token: { ...signedIn },
      trigger: "update",
      session: {},
    });
    expect(token?.config).toEqual({
      autoSave: { enabled: false },
      llm: { chat: CHAT },
    });
    expect(token?.name).toBe("Ada Lovelace");
  });

  test("takes nothing about the user from the page that asked", async () => {
    const token = await sessionToken(db, {
      token: { ...signedIn },
      trigger: "update",
      session: { user: { name: "Someone else", email: "else@example.test" } },
    });
    expect(token?.name).toBe("Ada Lovelace");
    expect(token?.email).toBe("ada-stoken@example.test");
  });

  test("is left alone by an ordinary read", async () => {
    const token = await sessionToken(db, { token: { ...signedIn } });
    expect(token).toEqual(signedIn);
  });
});

describe("the session while the database cannot answer", () => {
  test("stays signed in rather than signing everyone out", async () => {
    const unreachable = {
      query: {
        users: {
          findFirst: async () => {
            throw new Error("database unreachable");
          },
        },
      },
    } as unknown as typeof db;
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        await sessionToken(unreachable, { token: { ...signedIn } }),
      ).toEqual(signedIn);
    } finally {
      error.mockRestore();
    }
  });
});
