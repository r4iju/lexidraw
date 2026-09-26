import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, type SerializedEditorState } from "lexical";
import { SCHEMA_NODES } from "./nodes.js";

/** A stored document, as the nodes wrote it before they declared their JSON. */
const EVERY_NODE = await Bun.file(
  new URL("../test/every-node.json", import.meta.url),
).json();

function editor() {
  return createHeadlessEditor({
    nodes: SCHEMA_NODES,
    onError: (error) => {
      throw error;
    },
  });
}

function written(state: unknown) {
  return JSON.parse(JSON.stringify(state));
}

/** What a stored top-level node reads back as. */
function readBack(node: object) {
  const reader = editor();
  reader.setEditorState(
    reader.parseEditorState(
      document([node]) as unknown as SerializedEditorState,
    ),
  );
  return written(reader.getEditorState()).root.children[0];
}

function document(children: unknown[]) {
  return {
    root: { ...element("root", {}, children) },
  };
}

function element(type: string, fields: object = {}, children: unknown[] = []) {
  return {
    type,
    version: 1,
    children,
    direction: null,
    format: "",
    indent: 0,
    ...fields,
  };
}

function paragraph(children: unknown[] = []) {
  return element("paragraph", { textFormat: 0, textStyle: "" }, children);
}

const comment = {
  type: "comment",
  version: 1,
  comment: {
    author: "Ada",
    content: "Nice",
    deleted: false,
    id: "c1",
    timeStamp: 1,
    type: "comment",
  },
  format: 3,
  indent: 2,
  direction: null,
  children: [],
};

test("a stored document with every node reads and writes back unchanged", () => {
  const reader = editor();

  reader.setEditorState(reader.parseEditorState(EVERY_NODE));

  expect(written(reader.getEditorState())).toEqual(EVERY_NODE);
});

test("values the nodes turned down before are still turned down", () => {
  expect(
    readBack(element("callout", { kind: "shout", title: 5 }, [paragraph()])),
  ).toMatchObject({ kind: "note", title: "" });
  expect(
    readBack(element("footnote-definition", { label: 5 }, [paragraph()])),
  ).toMatchObject({ label: "" });
  expect(
    readBack(paragraph([{ ...comment, direction: "rtl" }])).children[0],
  ).toEqual(comment);
});

test("a collapsible title keeps the alignment and indent it was stored with", () => {
  const title = element(
    "collapsible-title",
    { format: "center", indent: 1 },
    [],
  );

  expect(
    readBack(
      element("collapsible-container", { open: true }, [
        title,
        element("collapsible-content", {}, [paragraph()]),
      ]),
    ).children[0],
  ).toEqual(title);
});

test("a comment marker keeps its format and indent when it changes", () => {
  const reader = editor();
  reader.setEditorState(
    reader.parseEditorState(
      document([paragraph([comment])]) as unknown as SerializedEditorState,
    ),
  );

  reader.update(
    () => {
      $getRoot().getFirstDescendant()?.getWritable();
    },
    { discrete: true },
  );

  expect(written(reader.getEditorState()).root.children[0].children[0]).toEqual(
    comment,
  );
});
