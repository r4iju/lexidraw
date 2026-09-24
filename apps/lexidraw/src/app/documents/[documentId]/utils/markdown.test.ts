/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $convertToMarkdownString } from "@lexical/markdown";
import {
  $getDocumentHeader,
  CORE_NODES,
  CORE_TRANSFORMERS,
} from "@packages/lexical-nodes";
import { $getRoot } from "lexical";
import { interpretDocumentMarkdown } from "~/server/documents/markdown";
import { $insertMarkdown, type MarkdownImport } from "./markdown";

function importInto(
  existing: string,
  markdown: string,
  mode: "start" | "end" | "replace",
  title: string,
  lang: string | null = null,
) {
  const editor = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  let result: MarkdownImport = {};
  editor.update(
    () => {
      if (existing) $insertMarkdown(existing, "replace", { title: "Notes" });
      result = $insertMarkdown(markdown, mode, { title, lang });
    },
    { discrete: true },
  );
  return editor.getEditorState().read(() => ({
    result,
    header: $getDocumentHeader(),
    markdown: $convertToMarkdownString(CORE_TRANSFORMERS),
    blocks: $getRoot().getChildrenSize(),
  }));
}

describe("importing markdown in the editor", () => {
  test("front matter becomes the header, not text", () => {
    const { header, markdown, result } = importInto(
      "",
      "---\nsubtitle: Two days\ntoc: true\nproperties:\n  status: draft\n---\n\nBody",
      "replace",
      "Kyoto",
    );
    expect(header).toEqual({
      subtitle: "Two days",
      toc: true,
      properties: [{ key: "status", value: "draft" }],
    });
    expect(markdown).toBe("Body");
    expect(result).toEqual({});
  });

  test("a leading heading names an untitled document and leaves the content", () => {
    const { markdown, result } = importInto(
      "",
      "# Kyoto in Autumn\n\nMaples.",
      "replace",
      "Untitled",
    );
    expect(result.title).toBe("Kyoto in Autumn");
    expect(markdown).toBe("Maples.");
  });

  test("a leading heading repeating the title is shown once", () => {
    const { markdown, result } = importInto(
      "",
      "# Kyoto in autumn\n\nMaples.",
      "replace",
      "Kyoto in Autumn",
    );
    expect(result.title).toBeUndefined();
    expect(markdown).toBe("Maples.");
  });

  test("a heading added to the end of a document stays a heading", () => {
    const { markdown, result } = importInto(
      "Existing.",
      "# Kyoto in Autumn\n\nMaples.",
      "end",
      "Untitled",
    );
    expect(result.title).toBeUndefined();
    expect(markdown).toBe("Existing.\n\n# Kyoto in Autumn\n\nMaples.");
  });

  test("a title in front matter is the title the import gives", () => {
    const { result } = importInto(
      "",
      "---\ntitle: Autumn\n---\n\n# Autumn\n\nMaples.",
      "replace",
      "Kyoto",
    );
    expect(result.title).toBe("Autumn");
  });

  test("notes added at the start still end the document", () => {
    const { markdown } = importInto(
      "Existing.",
      "New[^1].\n\n[^1]: A note.",
      "start",
      "Kyoto",
    );
    expect(markdown).toBe("New[^1].\n\nExisting.\n\n[^1]: A note.");
  });

  test("front matter sets the tags and language, as an import through the API does", () => {
    const markdown =
      "---\ntitle: Kyoto\ntags: [travel, japan]\nlang: ja\n---\n\n紅葉。";
    const { result } = importInto("", markdown, "replace", "Untitled");
    expect(result).toEqual({
      title: "Kyoto",
      tags: ["travel", "japan"],
      lang: "ja",
    });
    expect(result).toEqual(
      interpretDocumentMarkdown(markdown, {
        title: "Untitled",
        titleFromHeading: true,
      }).fields,
    );
  });

  test("front matter without a language goes back to detecting it", () => {
    const { result } = importInto(
      "",
      "---\nsubtitle: Two days\n---\n\nBody",
      "replace",
      "Kyoto",
      "ja",
    );
    expect(result).toEqual({ lang: null });
  });

  test("markdown without front matter leaves the tags and language alone", () => {
    const { result } = importInto("", "Body", "replace", "Kyoto", "ja");
    expect(result).toEqual({});
  });
});
