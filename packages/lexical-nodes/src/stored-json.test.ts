import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $dfs } from "@lexical/utils";
import {
  $getRoot,
  ArtificialNode__DO_NOT_USE,
  type SerializedEditorState,
} from "lexical";
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

test("the stored document holds every node a document can", () => {
  const types = new Set<string>();
  const collect = (node: { type: string; children?: unknown[] }) => {
    types.add(node.type);
    for (const child of node.children ?? []) collect(child as typeof node);
  };
  collect(EVERY_NODE.root);

  expect(
    [...editor()._nodes.keys()].filter(
      (type) =>
        type !== ArtificialNode__DO_NOT_USE.getType() && !types.has(type),
    ),
  ).toEqual([]);
});

test("a stored document with every node reads and writes back unchanged", () => {
  const reader = editor();

  reader.setEditorState(reader.parseEditorState(EVERY_NODE));

  expect(written(reader.getEditorState())).toEqual(EVERY_NODE);
});

const EMPTY_CAPTION = {
  editorState: { root: element("root") },
};

/** The caption a video without one has always been given. */
const VIDEO_CAPTION = { root: element("root", {}, [paragraph()]) };

test("every node keeps what it stores when it changes", () => {
  const reader = editor();
  reader.setEditorState(reader.parseEditorState(EVERY_NODE));

  reader.update(
    () => {
      for (const { node } of $dfs()) node.getWritable();
    },
    { discrete: true },
  );

  expect(written(reader.getEditorState())).toEqual(EVERY_NODE);
});

test("older shapes of the heavy nodes still read as they did", () => {
  const block = (type: string, fields: object) =>
    readBack({ type, version: 1, ...fields });
  const inline = (type: string, fields: object) =>
    readBack(paragraph([{ type, version: 1, ...fields }])).children[0];

  expect(
    inline("image", { src: "/a.png", altText: "", caption: EMPTY_CAPTION }),
  ).toMatchObject({ width: 0, height: 0, maxWidth: 500, showCaption: false });
  expect(
    inline("inline-image", {
      src: "/a.png",
      altText: "",
      caption: EMPTY_CAPTION,
    }),
  ).toEqual({
    type: "inline-image",
    version: 1,
    src: "/a.png",
    altText: "",
    caption: EMPTY_CAPTION,
    width: 0,
    height: 0,
    showCaption: false,
    captionsEnabled: true,
  });
  expect(block("video", { src: "/a.mp4" })).toEqual({
    type: "video",
    version: 1,
    src: "/a.mp4",
    caption: VIDEO_CAPTION,
    width: 0,
    height: 0,
    showCaption: false,
    captionsEnabled: false,
  });
  expect(
    block("video", { src: "/a.mp4", caption: { root: element("root") } }),
  ).toMatchObject({ caption: VIDEO_CAPTION });
  expect(block("youtube", { videoID: "x", format: "" })).toMatchObject({
    width: 0,
    height: 0,
  });
  expect(block("mermaid", { schema: "graph", width: 0, height: 0 })).toEqual({
    type: "mermaid",
    version: 1,
    schema: "graph",
    width: "inherit",
    height: "inherit",
  });
  expect(block("mermaid", {})).toMatchObject({
    schema: "graph TD;\n  A[Start] --> B>Stop]",
  });
  expect(block("chart", { chartType: "pie", width: 0 })).toEqual({
    type: "chart",
    version: 1,
    chartType: "pie",
    chartData: "[]",
    chartConfig: "{}",
    width: "inherit",
    height: "inherit",
  });
  expect(inline("excalidraw", {})).toEqual({
    type: "excalidraw",
    version: 1,
    data: "[]",
    width: "inherit",
    height: "inherit",
  });
  expect(block("equation", { equation: "x" })).toMatchObject({
    inline: false,
  });
  expect(
    block("code", { ...element("code"), language: "js", theme: "dracula" }),
  ).toEqual({ ...element("code"), language: "js", showLineNumbers: false });
  expect(
    block("article", { data: { mode: "entity", entityId: "a" } }),
  ).toMatchObject({ format: "" });
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
