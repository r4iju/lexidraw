import { expect, test } from "bun:test";
import { CONTEXTS_PATH, webEditorContexts, swiftForEditorContexts } from "./editor-contexts";

test("nested typing contexts come from mounted web plugins", async () => {
  const contexts = await webEditorContexts();
  for (const name of ["imageCaption", "inlineImageCaption", "videoCaption"] as const) {
    expect(contexts[name]).toContain("HashtagPlugin");
    expect(contexts[name]).toContain("KeywordsPlugin");
    expect(contexts[name]).not.toContain("MarkdownShortcutPlugin");
  }
  expect(contexts.slide).toContain("MarkdownShortcutPlugin");
  expect(await Bun.file(CONTEXTS_PATH).text()).toBe(await swiftForEditorContexts());
});
