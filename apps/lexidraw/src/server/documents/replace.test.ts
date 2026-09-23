/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $createHeadingNode } from "@lexical/rich-text";
import {
  ArticleNode,
  ChartNode,
  CommentNode,
  CORE_NODES,
  ExcalidrawNode,
  FigmaNode,
  InlineImageNode,
  MermaidNode,
  PageBreakNode,
  PLACEHOLDER_NODE_TYPES,
  PollNode,
  SlideNode,
  StickyNode,
  ThreadNode,
  VideoNode,
  YouTubeNode,
} from "@packages/lexical-nodes";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from "lexical";
import { editorStateToMarkdown, markdownToEditorState } from "./markdown";
import {
  DuplicatePlaceholderError,
  PlaceholderPlacementError,
  replaceStateFromMarkdown,
  sameBlock,
  UnknownPlaceholderError,
} from "./replace";

function stateOf(build: () => void): SerializedEditorState {
  const editor = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(build, { discrete: true });
  return editor.getEditorState().toJSON();
}

/** Every placeholder the state holds, keyed the way the export names it. */
function placeholders(state: SerializedEditorState): Map<string, string> {
  const found = new Map<string, string>();
  const ordinals = new Map<string, number>();
  const visit = (node: SerializedLexicalNode) => {
    if (PLACEHOLDER_NODE_TYPES.includes(node.type)) {
      const ordinal = (ordinals.get(node.type) ?? 0) + 1;
      ordinals.set(node.type, ordinal);
      found.set(`${node.type}#${ordinal}`, JSON.stringify(node));
    }
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children as SerializedLexicalNode[])
        visit(child);
    }
  };
  for (const child of state.root.children) visit(child);
  return found;
}

const placeholderJson = (state: SerializedEditorState, ref: string): string =>
  placeholders(state).get(ref) ?? `no ${ref}`;

const types = (state: SerializedEditorState) =>
  state.root.children.map((child) => child.type);

const childrenOf = (node: SerializedLexicalNode | undefined) =>
  (node as { children?: SerializedLexicalNode[] } | undefined)?.children ?? [];

/** One of every node that travels as a placeholder, block-level and inline. */
const EVERY_KIND = stateOf(() => {
  $getRoot().append(
    $createHeadingNode("h1").append($createTextNode("Title")),
    $createParagraphNode().append(
      $createTextNode("before "),
      InlineImageNode.$createInlineImageNode({
        altText: "logo",
        src: "https://example.com/logo.png",
      }),
      $createTextNode(" after "),
      ChartNode.$createChartNode({ chartType: "pie" }),
    ),
    VideoNode.$createVideoNode({ src: "https://example.com/clip.mp4" }),
    YouTubeNode.$createYouTubeNode("dQw4w9WgXcQ"),
    FigmaNode.$createFigmaNode("abc"),
    PageBreakNode.$createPageBreakNode(),
    StickyNode.$createStickyNode(0, 0),
    $createParagraphNode().append(PollNode.$createPollNode("Lunch?", [])),
    SlideNode.$createSlideNode({
      slides: [{ id: "s1", elements: [] }],
      currentSlideId: "s1",
    }),
    $createParagraphNode().append(ExcalidrawNode.$createExcalidrawNode()),
    $createParagraphNode().append(
      MermaidNode.$createMermaidNode("flowchart LR\n  A --> B"),
    ),
    $createParagraphNode().append(
      $createTextNode("see "),
      new CommentNode({
        author: "ada",
        content: "Tighten this",
        deleted: false,
        id: "c1",
        timeStamp: 0,
        type: "comment",
      }),
      new ThreadNode({
        comments: [],
        id: "t1",
        quote: "the quoted text",
        type: "thread",
      }),
      $createTextNode(" end"),
    ),
    $createParagraphNode().append($createTextNode("Body text.")),
  );
});

const EVERY_KIND_MARKDOWN = editorStateToMarkdown(EVERY_KIND);

const withoutLine = (markdown: string, line: string) =>
  markdown
    .split("\n\n")
    .filter((block) => block !== line)
    .join("\n\n");

describe("replaceStateFromMarkdown", () => {
  test("the markdown a read produced replaces the document with itself", () => {
    const { state, restoredPlaceholders, removedPlaceholders } =
      replaceStateFromMarkdown(EVERY_KIND, EVERY_KIND_MARKDOWN);

    expect(types(state)).toEqual(types(EVERY_KIND));
    expect(placeholders(state)).toEqual(placeholders(EVERY_KIND));
    expect(restoredPlaceholders).toBe(placeholders(EVERY_KIND).size);
    expect(removedPlaceholders).toBe(0);
    // Reading the result back gives the markdown it was written from, so the
    // round trip is a fixed point rather than a one-off match.
    expect(editorStateToMarkdown(state)).toBe(EVERY_KIND_MARKDOWN);
  });

  test("a placeholder the caller dropped deletes exactly its node", () => {
    const { state, restoredPlaceholders, removedPlaceholders } =
      replaceStateFromMarkdown(
        EVERY_KIND,
        withoutLine(
          EVERY_KIND_MARKDOWN,
          "<!-- lexidraw:video#1 https://example.com/clip.mp4 -->",
        ),
      );

    expect(types(state)).toEqual(
      types(EVERY_KIND).filter((type) => type !== "video"),
    );
    const kept = placeholders(state);
    expect(kept.has("video#1")).toBe(false);
    // The others keep their nodes; the ordinals are recomputed on the next
    // read, so nothing else has to be renumbered here.
    for (const [ref, node] of placeholders(EVERY_KIND)) {
      if (ref === "video#1") continue;
      expect(kept.get(ref)).toBe(node);
    }
    expect(restoredPlaceholders).toBe(placeholders(EVERY_KIND).size - 1);
    expect(removedPlaceholders).toBe(1);
  });

  test("an inline placeholder inside a sentence comes back inline", () => {
    const { state } = replaceStateFromMarkdown(
      EVERY_KIND,
      "Look <!-- lexidraw:comment#1 a summary the caller rewrote --> here.",
    );

    expect(types(state)).toEqual(["paragraph"]);
    const children = childrenOf(state.root.children[0]);
    expect(children.map((child) => child.type)).toEqual([
      "text",
      "comment",
      "text",
    ]);
    expect(JSON.stringify(children[1])).toBe(
      placeholderJson(EVERY_KIND, "comment#1"),
    );
    expect(
      children.map((child) => ("text" in child ? child.text : "")),
    ).toEqual(["Look ", "", " here."]);
  });

  test("a block placeholder has to stand alone on its line", () => {
    expect(() =>
      replaceStateFromMarkdown(
        EVERY_KIND,
        "Look <!-- lexidraw:video#1 https://example.com/clip.mp4 --> here.",
      ),
    ).toThrow(new PlaceholderPlacementError("video#1"));
  });

  test("an unknown placeholder names the ones the document has", () => {
    expect(() =>
      replaceStateFromMarkdown(EVERY_KIND, "<!-- lexidraw:video#7 gone -->"),
    ).toThrow(
      new UnknownPlaceholderError("video#7", [
        ...placeholders(EVERY_KIND).keys(),
      ]),
    );
  });

  test("a placeholder used twice is rejected", () => {
    expect(() =>
      replaceStateFromMarkdown(
        EVERY_KIND,
        "<!-- lexidraw:video#1 -->\n\n<!-- lexidraw:video#1 -->",
      ),
    ).toThrow(new DuplicatePlaceholderError("video#1"));
  });
});

const WITH_ARTICLE = stateOf(() => {
  $getRoot().append(
    $createParagraphNode().append($createTextNode("Intro.")),
    ArticleNode.$createArticleNode({
      mode: "url",
      url: "https://example.com/post",
      distilled: {
        title: "On splitting nodes",
        contentHtml: "<p>First para.</p><p>Second para.</p>",
      },
    }),
    $createParagraphNode().append($createTextNode("Outro.")),
  );
});

const ARTICLE_MARKDOWN = editorStateToMarkdown(WITH_ARTICLE);

describe("replaceStateFromMarkdown with an article", () => {
  test("the placeholder keeps the node and drops the prose it derived", () => {
    expect(ARTICLE_MARKDOWN).toBe(
      [
        "Intro.",
        "<!-- lexidraw:article#1 On splitting nodes -->",
        "### On splitting nodes",
        "[Source](https://example.com/post)",
        "First para.\nSecond para.",
        "Outro.",
      ].join("\n\n"),
    );

    const { state, restoredPlaceholders } = replaceStateFromMarkdown(
      WITH_ARTICLE,
      ARTICLE_MARKDOWN,
    );

    expect(types(state)).toEqual(["paragraph", "article", "paragraph"]);
    expect(placeholders(state)).toEqual(placeholders(WITH_ARTICLE));
    expect(restoredPlaceholders).toBe(1);
  });

  test("prose the caller edited stays as content of its own", () => {
    const { state } = replaceStateFromMarkdown(
      WITH_ARTICLE,
      ARTICLE_MARKDOWN.replace(
        "First para.\nSecond para.",
        "First para, edited.",
      ),
    );

    expect(types(state)).toEqual([
      "paragraph",
      "article",
      "paragraph",
      "paragraph",
    ]);
    expect(JSON.stringify(state.root.children[2])).toContain(
      "First para, edited.",
    );
  });
});

describe("sameBlock", () => {
  const block = (markdown: string) =>
    markdownToEditorState(markdown).root.children[0] as SerializedLexicalNode;

  test("blocks that read the same are the same block", () => {
    expect(sameBlock(block("A line."), block("A line."))).toBe(true);
    expect(sameBlock(block("A line."), block("Another line."))).toBe(false);
    expect(sameBlock(block("## A line."), block("A line."))).toBe(false);
    expect(sameBlock(block("A **bold** line."), block("A bold line."))).toBe(
      false,
    );
  });

  test("the direction a block renders in is not part of it", () => {
    const left = block("A line.");
    const rendered = { ...left, direction: "ltr" } as SerializedLexicalNode;
    expect(sameBlock(rendered, left)).toBe(true);
  });
});
