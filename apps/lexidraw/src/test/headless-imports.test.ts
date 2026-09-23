/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

// These modules feed the server-side markdown pipeline; they must load in a
// runtime that has no `window` or `document`.
describe("editor modules load without a DOM", () => {
  test("markdown transformers", async () => {
    const mod = await import(
      "../app/documents/[documentId]/plugins/MarkdownTransformers/index"
    );
    expect(Array.isArray(mod.PLAYGROUND_TRANSFORMERS)).toBe(true);
  });

  test("image plugins", async () => {
    await import("../app/documents/[documentId]/plugins/ImagePlugin/index");
    await import(
      "../app/documents/[documentId]/plugins/InlineImagePlugin/index"
    );
  });
});
