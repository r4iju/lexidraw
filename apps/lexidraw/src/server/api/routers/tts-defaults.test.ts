/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const started: unknown[][] = [];
mock.module("workflow/api", () => ({
  start: async (_workflow: unknown, args: unknown[]) => {
    started.push(args);
    return {};
  },
}));
const { ttsRouter } = await import("~/server/api/routers/tts");
const { configRouter } = await import("~/server/api/routers/config");

const NEW = "ttsdef_user";
// Saved a voice of macOS `say`, a service the app no longer has.
const STALE = "ttsdef_stale";
// Picked Google and left the voice to its default.
const PICKED = "ttsdef_picked";
// Picked a Chirp3-HD voice of Google Cloud TTS, whose voices Gemini has.
const CHIRP = "ttsdef_chirp";
// Picked a voice only Google Cloud TTS had.
const CLOUD = "ttsdef_cloud";
// Picked a voice of OpenAI, the default service before Gemini.
const OPENAI_VOICE = "ttsdef_openai_voice";
// Asked for Ogg, which Gemini does not make.
const GEMINI_OGG = "ttsdef_gemini_ogg";
const contextOf = (userId: string) =>
  ({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  }) as never;
const at = new Date("2026-09-01T00:00:00.000Z");
const entity = (id: string, entityType: string, userId: string) => ({
  id,
  title: id,
  elements: "{}",
  entityType,
  userId,
  publicAccess: PublicAccess.PRIVATE,
  createdAt: at,
  updatedAt: at,
});

beforeAll(async () => {
  await db.insert(schema.users).values([
    // An account that has never saved its Listen settings.
    { id: NEW, name: "New", email: "ttsdef@example.test" },
    {
      id: STALE,
      name: "Stale",
      email: "ttsdef-stale@example.test",
      // Saved before macOS `say` was removed; the type no longer has it.
      config: { tts: { provider: "apple_say", voiceId: "Alva" } } as never,
    },
    {
      id: PICKED,
      name: "Picked",
      email: "ttsdef-picked@example.test",
      config: { tts: { provider: "google" } },
    },
    {
      id: CHIRP,
      name: "Chirp",
      email: "ttsdef-chirp@example.test",
      config: { tts: { provider: "google", voiceId: "en-US-Chirp3-HD-Puck" } },
    },
    {
      id: CLOUD,
      name: "Cloud",
      email: "ttsdef-cloud@example.test",
      config: { tts: { provider: "google", voiceId: "en-US-Standard-C" } },
    },
    {
      id: OPENAI_VOICE,
      name: "OpenAI voice",
      email: "ttsdef-openai-voice@example.test",
      config: { tts: { voiceId: "nova" } },
    },
    {
      id: GEMINI_OGG,
      name: "Gemini Ogg",
      email: "ttsdef-gemini-ogg@example.test",
      config: { tts: { format: "ogg" } },
    },
  ]);
  await db.insert(schema.entities).values(
    [NEW, STALE, PICKED, CHIRP, CLOUD, OPENAI_VOICE, GEMINI_OGG]
      .flatMap((userId) => [
        entity(`${userId}_doc`, "document", userId),
        entity(`${userId}_article`, "url", userId),
      ])
      .concat(entity(`${NEW}_ogg_doc`, "document", NEW))
      .concat(entity(`${NEW}_lang_doc`, "document", NEW)),
  );
});

const listens = {
  "a document": (userId: string) =>
    ttsRouter
      .createCaller(contextOf(userId))
      .startDocumentTts({ documentId: `${userId}_doc`, markdown: "Hello." }),
  "an article": (userId: string) =>
    ttsRouter.createCaller(contextOf(userId)).startArticleTts({
      articleId: `${userId}_article`,
      plainText: "Hello.",
    }),
};

const GEMINI = { provider: "google", voiceId: "Kore" };
describe.each([
  ["that never saved its settings", NEW, GEMINI],
  ["whose saved voice service is gone", STALE, GEMINI],
  ["that picked a service but no voice", PICKED, GEMINI],
  [
    "that picked a Google voice Gemini also has",
    CHIRP,
    { provider: "google", voiceId: "Puck" },
  ],
  ["that picked a voice Gemini does not have", CLOUD, GEMINI],
  [
    "that picked a voice when OpenAI was the default",
    OPENAI_VOICE,
    { provider: "openai", voiceId: "nova" },
  ],
])("read-aloud for an account %s", (_, userId, voice) => {
  test.each(Object.entries(listens))(
    "reads %s in the default voice its settings show",
    async (_, listen) => {
      const shown = await configRouter
        .createCaller(contextOf(userId))
        .getTtsConfig();
      started.length = 0;

      await listen(userId);

      const cfg = started[0]?.at(-2) as { provider: string; voiceId: string };
      expect({ provider: cfg?.provider, voiceId: cfg?.voiceId }).toEqual({
        provider: shown.provider,
        voiceId: shown.voiceId,
      });
      expect(shown).toMatchObject(voice);
    },
  );
});

describe("read-aloud in Gemini for an account that asked for Ogg", () => {
  test.each(Object.entries(listens))(
    "reads %s in MP3, as its settings show",
    async (_, listen) => {
      const shown = await configRouter
        .createCaller(contextOf(GEMINI_OGG))
        .getTtsConfig();
      started.length = 0;

      await listen(GEMINI_OGG);

      const cfg = started[0]?.at(-2) as { format: string };
      expect({ shown: shown.format, read: cfg?.format }).toEqual({
        shown: "mp3",
        read: "mp3",
      });
    },
  );

  test("reads in MP3 when a player asks for Ogg", async () => {
    started.length = 0;

    await ttsRouter.createCaller(contextOf(NEW)).startDocumentTts({
      documentId: `${NEW}_ogg_doc`,
      markdown: "Hello again.",
      format: "ogg",
    });

    const cfg = started[0]?.at(-2) as { format: string };
    expect(cfg?.format).toBe("mp3");
  });
});

describe("read-aloud in Gemini, which tells languages apart itself", () => {
  test("keeps the audio made when only the language changes", async () => {
    const read = (languageCode: string) =>
      ttsRouter.createCaller(contextOf(NEW)).startDocumentTts({
        documentId: `${NEW}_lang_doc`,
        markdown: "Hej hej.",
        languageCode,
      });
    started.length = 0;

    const first = await read("en-US");
    const second = await read("sv-SE");

    expect(second.docKey).toBe(first.docKey);
    expect(started).toHaveLength(1);
  });
});
