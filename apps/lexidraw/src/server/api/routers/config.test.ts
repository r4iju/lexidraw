/// <reference types="bun" />
import { beforeAll, describe, expect, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import {
  DEFAULT_GOOGLE_AGENT_MODEL_ID,
  DEFAULT_GOOGLE_AUTOCOMPLETE_MODEL_ID,
  DEFAULT_GOOGLE_CHAT_MODEL_ID,
  DEFAULT_OPENAI_AUTOCOMPLETE_MODEL_ID,
} from "~/lib/llm-models";
import {
  createTestDatabase,
  installServerRuntime,
} from "~/test/server-runtime";

await installServerRuntime();
const { configRouter } = await import("./config");

// Its own database, where the one user is the row a lookup that forgot to
// filter by the caller would land on.
const db = await createTestDatabase();

const SETTLED_USER = "config_settled_user";
const NEW_USER = "config_new_user";
const OPTED_OUT_USER = "config_opted_out_user";

/** A value other than the default in every section a settings read serves. */
const STORED = {
  llm: {
    chat: {
      modelId: "stored-chat",
      provider: "openai",
      temperature: 0.1,
      maxOutputTokens: 1111,
    },
    autocomplete: {
      modelId: "stored-autocomplete",
      provider: "openai",
      temperature: 0.2,
      maxOutputTokens: 222,
    },
    agent: {
      modelId: "stored-agent",
      provider: "openai",
      temperature: 0.3,
      maxOutputTokens: 3333,
    },
  },
  autocomplete: {
    enabled: false,
    delayMs: 900,
    provider: "openai" as const,
    modelId: "stored-inline",
    temperature: 0.9,
    maxOutputTokens: 99,
    reasoningEffort: "heavy" as const,
    verbosity: "high" as const,
  },
  audio: { preferredPlaybackRate: 1.5 },
  tts: {
    provider: "google" as const,
    voiceId: "stored-voice",
    speed: 2,
    format: "wav" as const,
    languageCode: "sv-SE",
  },
  articles: {
    languageCode: "sv-SE",
    maxChars: 500,
    keepQuotes: false,
    autoGenerateAudioOnImport: true,
  },
  autoSave: { enabled: true },
};

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
  await db.insert(schema.users).values({
    id: SETTLED_USER,
    name: "Settled",
    email: "config-settled@example.test",
    config: STORED,
  });
  await db.insert(schema.users).values([
    { id: NEW_USER, name: "New", email: "config-new@example.test" },
    {
      id: OPTED_OUT_USER,
      name: "Opted out",
      email: "config-opted-out@example.test",
      config: { autoSave: { enabled: false } },
    },
  ]);
});

describe("a visitor with no account", () => {
  test("reads the default LLM config", async () => {
    expect(await visitor.getConfig()).toEqual({
      chat: {
        modelId: DEFAULT_GOOGLE_CHAT_MODEL_ID,
        provider: "google",
        temperature: 0.7,
        maxOutputTokens: 65535,
      },
      autocomplete: {
        modelId: DEFAULT_GOOGLE_AUTOCOMPLETE_MODEL_ID,
        provider: "google",
        temperature: 0.3,
        maxOutputTokens: 500,
      },
      agent: {
        modelId: DEFAULT_GOOGLE_AGENT_MODEL_ID,
        provider: "google",
        temperature: 0.7,
        maxOutputTokens: 65535,
      },
    });
  });

  test("reads the default playback rate", async () => {
    expect(await visitor.getAudioConfig()).toEqual({
      preferredPlaybackRate: 1,
    });
  });

  test("reads auto-save as on", async () => {
    expect(await visitor.getAutoSaveConfig()).toEqual({ enabled: true });
  });

  test("reads the default TTS settings", async () => {
    expect(await visitor.getTtsConfig()).toEqual({
      provider: "openai",
      voiceId: "alloy",
      speed: 1,
      format: "mp3",
      languageCode: "en-US",
    });
  });

  test("reads the default article settings", async () => {
    expect(await visitor.getArticleConfig()).toEqual({
      languageCode: "en-US",
      maxChars: 120000,
      keepQuotes: true,
      autoGenerateAudioOnImport: false,
    });
  });

  test("reads the default autocomplete settings", async () => {
    expect(await visitor.getAutocompleteConfig()).toEqual({
      enabled: true,
      delayMs: 200,
      provider: "openai",
      modelId: DEFAULT_OPENAI_AUTOCOMPLETE_MODEL_ID,
      temperature: 0.3,
      maxOutputTokens: 400,
      reasoningEffort: "minimal",
      verbosity: "low",
    });
  });

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
  const owner = callerFor(SETTLED_USER);
  expect(await owner.getAudioConfig()).toEqual(STORED.audio);
  expect(await owner.getAutoSaveConfig()).toEqual(STORED.autoSave);
  expect(await owner.getTtsConfig()).toEqual(STORED.tts);
  expect(await owner.getArticleConfig()).toEqual(STORED.articles);
  // Typed by its defaults, which are narrower than what may be stored.
  const autocomplete: unknown = await owner.getAutocompleteConfig();
  expect(autocomplete).toEqual(STORED.autocomplete);
  expect(await owner.getConfig()).toEqual(STORED.llm);
});

describe("auto-save", () => {
  test("is on for a new account", async () => {
    expect(await callerFor(NEW_USER).getAutoSaveConfig()).toEqual({
      enabled: true,
    });
  });

  test("stays off for someone who turned it off", async () => {
    expect(await callerFor(OPTED_OUT_USER).getAutoSaveConfig()).toEqual({
      enabled: false,
    });
  });
});
