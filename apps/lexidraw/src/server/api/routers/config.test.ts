/// <reference types="bun" />
import { beforeAll, describe, expect, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { configRouter } = await import("./config");

const NEW_USER = "config_new_user";
const SETTLED_USER = "config_settled_user";

function callerFor(userId: string | null) {
  return configRouter.createCaller({
    drizzle: db,
    schema,
    session: userId ? { user: { id: userId }, expires: "2099-01-01" } : null,
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
}

const visitor = callerFor(null);

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: NEW_USER, name: "New", email: "config-new@example.test" },
    {
      id: SETTLED_USER,
      name: "Settled",
      email: "config-settled@example.test",
      config: { audio: { preferredPlaybackRate: 1.5 } },
    },
  ]);
});

describe("a visitor with no account", () => {
  const reads = [
    "getConfig",
    "getAudioConfig",
    "getAutoSaveConfig",
    "getTtsConfig",
    "getArticleConfig",
    "getAutocompleteConfig",
  ] as const;

  for (const read of reads) {
    test(`reads the ${read} defaults a new account starts with`, async () => {
      const fresh = await callerFor(NEW_USER)[read]();
      expect(await visitor[read]()).toEqual(fresh);
    });
  }

  test("is refused every settings write", async () => {
    const writes = [
      () => visitor.updateLlmConfig({}),
      () => visitor.updateAudioConfig({ preferredPlaybackRate: 1.25 }),
      () => visitor.updateAutoSaveConfig({ enabled: true }),
      () => visitor.updateTtsConfig({}),
      () => visitor.updateArticleConfig({}),
      () => visitor.updateAutocompleteConfig({}),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  test("is refused the TTS catalog", async () => {
    await expect(visitor.getTtsCatalog()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

test("a signed-in reader still gets the settings they stored", async () => {
  expect(await callerFor(SETTLED_USER).getAudioConfig()).toEqual({
    preferredPlaybackRate: 1.5,
  });
});
