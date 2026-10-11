import { expect, test } from "bun:test";
import { createEditor } from "lexical";
import { ImageNode } from "@packages/lexical-nodes";
import { OpenEntitySync } from "../open-entity-sync";
import { insertRetainedImage } from "./insert";

test("image insertion acknowledges actual saved JSON and retry has one receipt node", async () => {
  const empty = JSON.stringify({
    root: {
      type: "root",
      version: 1,
      children: [
        {
          type: "paragraph",
          version: 1,
          children: [],
          direction: null,
          format: "",
          indent: 0,
        },
      ],
      direction: null,
      format: "",
      indent: 0,
    },
  });
  let stored = empty;
  let revision = new Date(1000);
  const sync = new OpenEntitySync(
    { elements: stored, updatedAt: revision },
    {
      save: async (content) => {
        stored = content.elements;
        revision = new Date(revision.getTime() + 1);
        return revision;
      },
      load: async () => ({ elements: stored, updatedAt: revision }),
      updatedAt: async () => revision,
    },
    () => {},
  );
  const editor = createEditor({
    nodes: [ImageNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.setEditorState(editor.parseEditorState(empty));
  const persist = (state: import("lexical").EditorState) =>
    sync.save({ elements: JSON.stringify(state) }, { receipt: true });
  const url =
    "https://app.test/api/generated-images/00000000-0000-4000-8000-000000000001";
  const first = await insertRetainedImage(
    editor,
    url,
    "Synthetic image",
    persist,
  );
  expect(first?.kind).toBe("saved");
  expect(stored).toContain(url);
  const second = await insertRetainedImage(
    editor,
    url,
    "Synthetic image",
    persist,
  );
  expect(second?.kind).toBe("saved");
  expect(stored.split(url)).toHaveLength(2);
  expect(first?.kind === "saved" && first.elements).toContain(url);
  expect(second?.kind === "saved" && second.revision).toEqual(revision);
});
