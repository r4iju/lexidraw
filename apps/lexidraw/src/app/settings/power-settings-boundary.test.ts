import { expect, test } from "bun:test";
import { SettingsSchema } from "./schema";
const profile = { name: "Ada", email: "ada@example.test" };
test("profile settings reject obsolete model, provider, tool and secret controls while retaining opt-in and playback speed", () => {
  for (const patch of [
    { chat: { modelId: "arbitrary" } },
    { agent: { provider: "google" } },
    { autocomplete: { modelId: "arbitrary" } },
    { autocomplete: { reasoningEffort: "heavy" } },
    { tts: { provider: "openai" } },
    { tts: { voiceId: "arbitrary" } },
    { apiKey: "fixture-only" },
    { upstream: "https://evil.test" },
  ])
    expect(SettingsSchema.safeParse({ ...profile, ...patch }).success).toBe(
      false,
    );
  expect(
    SettingsSchema.parse({
      ...profile,
      autocomplete: { enabled: true },
      tts: { speed: 1.25 },
    }),
  ).toMatchObject({ autocomplete: { enabled: true }, tts: { speed: 1.25 } });
});

test("document and article listening controls no longer expose legacy provider pickers", async () => {
  for (const path of [
    "src/app/documents/[documentId]/plugins/TtsToolbar.tsx",
    "src/app/urls/[urlId]/ArticlePreview.tsx",
  ]) {
    const source = await Bun.file(path).text();
    expect(source).not.toContain("tts-provider`");
    expect(source).toContain("/settings#settings-ai-power");
    expect(source).not.toContain("deleteTts.mutateAsync");
    expect(source).not.toContain("deleteArticleTts.mutateAsync");
  }
});
