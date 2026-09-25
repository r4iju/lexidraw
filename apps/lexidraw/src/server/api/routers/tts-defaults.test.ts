/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { TTS_DEFAULTS } from "~/app/settings/schema";
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
  ]);
  await db
    .insert(schema.entities)
    .values(
      [NEW, STALE, PICKED].flatMap((userId) => [
        entity(`${userId}_doc`, "document", userId),
        entity(`${userId}_article`, "url", userId),
      ]),
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

const OPENAI = {
  provider: TTS_DEFAULTS.provider,
  voiceId: TTS_DEFAULTS.voiceId,
};
describe.each([
  ["that never saved its settings", NEW, OPENAI],
  ["whose saved voice service is gone", STALE, OPENAI],
  [
    "that picked a service but no voice",
    PICKED,
    { provider: "google", voiceId: "en-US-Standard-C" },
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

      const cfg = started[0]?.at(-1) as { provider: string; voiceId: string };
      expect({ provider: cfg?.provider, voiceId: cfg?.voiceId }).toEqual({
        provider: shown.provider,
        voiceId: shown.voiceId,
      });
      expect(shown).toMatchObject(voice);
    },
  );
});
