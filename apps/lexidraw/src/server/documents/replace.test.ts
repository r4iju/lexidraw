/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $createLinkNode } from "@lexical/link";
import { $createHeadingNode } from "@lexical/rich-text";
import {
  ArticleNode,
  CalloutNode,
  ChartNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
  CommentNode,
  CORE_NODES,
  ExcalidrawNode,
  FigmaNode,
  InlineImageNode,
  LayoutContainerNode,
  LayoutItemNode,
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
import {
  editorStateToMarkdown,
  markdownToEditorState,
  UnsupportedNodeTypesError,
} from "./markdown";
import {
  DuplicatePlaceholderError,
  PlaceholderPlacementError,
  replaceStateFromMarkdown,
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

describe("replaceStateFromMarkdown and literal text", () => {
  test("a placeholder in a fenced block or in code spans stays text", () => {
    const markdown = [
      "```",
      "<!-- lexidraw:video#1 https://example.com/clip.mp4 -->",
      "```",
      "",
      "Write `<!-- lexidraw:chart#1 pie -->` to name it.",
    ].join("\n");

    const { state, restoredPlaceholders, removedPlaceholders } =
      replaceStateFromMarkdown(EVERY_KIND, markdown);

    expect(types(state)).toEqual(["code", "paragraph"]);
    expect(placeholders(state).size).toBe(0);
    expect(restoredPlaceholders).toBe(0);
    expect(removedPlaceholders).toBe(placeholders(EVERY_KIND).size);
    expect(editorStateToMarkdown(state)).toBe(markdown);
  });

  test("a mangled placeholder is text, so its node is dropped", () => {
    // Nothing resolves it, so nothing puts the node back; the count is the
    // only trace, which is why the read's spelling has to survive editing.
    const { state, removedPlaceholders } = replaceStateFromMarkdown(
      EVERY_KIND,
      "<!-- LEXIDRAW:video#1 https://example.com/clip.mp4 -->",
    );

    expect(types(state)).toEqual(["paragraph"]);
    expect(removedPlaceholders).toBe(placeholders(EVERY_KIND).size);
  });

  test("a trailing tab still leaves the placeholder alone on its line", () => {
    const { state } = replaceStateFromMarkdown(
      EVERY_KIND,
      "<!-- lexidraw:video#1 https://example.com/clip.mp4 -->\t",
    );

    expect(types(state)).toEqual(["video"]);
  });
});

/** A link holding an inline node, whose summary sits inside the link text. */
const LINKED = stateOf(() => {
  $getRoot().append(
    $createParagraphNode().append(
      $createLinkNode("https://example.com").append(
        $createTextNode("see "),
        InlineImageNode.$createInlineImageNode({
          altText: "logo",
          src: "https://example.com/logo.png",
        }),
      ),
    ),
  );
});

/** Markdown structure with no placeholder in it, to pin the plain round trip. */
const TABLE_AND_LIST = markdownToEditorState(
  "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- one\n  - nested\n- two\n\n> quoted",
);

describe("replaceStateFromMarkdown and document structure", () => {
  test("an inline placeholder inside a link comes back inside it", () => {
    const markdown = editorStateToMarkdown(LINKED);
    expect(markdown).toBe(
      "[see <!-- lexidraw:inline-image#1 logo https://example.com/logo.png -->](https://example.com)",
    );

    const { state } = replaceStateFromMarkdown(LINKED, markdown);

    expect(JSON.stringify(state)).toBe(JSON.stringify(LINKED));
  });

  test("tables, nested lists and quotes are a fixed point", () => {
    const { state } = replaceStateFromMarkdown(
      TABLE_AND_LIST,
      editorStateToMarkdown(TABLE_AND_LIST),
    );

    expect(JSON.stringify(state)).toBe(JSON.stringify(TABLE_AND_LIST));
  });

  test("a block placeholder inside a table cell is rejected", () => {
    expect(() =>
      replaceStateFromMarkdown(
        EVERY_KIND,
        "| <!-- lexidraw:video#1 x --> | b |\n| --- | --- |",
      ),
    ).toThrow(new PlaceholderPlacementError("video#1"));
  });

  test("a block placeholder alone in a list item is rejected", () => {
    expect(() =>
      replaceStateFromMarkdown(
        EVERY_KIND,
        "- <!-- lexidraw:video#1 https://example.com/clip.mp4 -->",
      ),
    ).toThrow(new PlaceholderPlacementError("video#1"));
  });

  test("a stored node type the editor cannot build is not silently erased", () => {
    const future: SerializedEditorState = {
      ...EVERY_KIND,
      root: {
        ...EVERY_KIND.root,
        children: [
          ...EVERY_KIND.root.children,
          { type: "future-widget", version: 1 },
        ],
      },
    };

    expect(() => replaceStateFromMarkdown(future, "Just a line.")).toThrow(
      UnsupportedNodeTypesError,
    );
  });
});

/** An article between an intro paragraph and whatever `after` parses to. */
function article(body: string, after = ""): SerializedEditorState {
  const base = stateOf(() => {
    $getRoot().append(
      $createParagraphNode().append($createTextNode("Intro.")),
      ArticleNode.$createArticleNode({
        mode: "url",
        url: "https://example.com/post",
        distilled: { title: "On splitting nodes", contentHtml: body },
      }),
    );
  });
  const trailing = after ? markdownToEditorState(after).root.children : [];
  return {
    ...base,
    root: { ...base.root, children: [...base.root.children, ...trailing] },
  };
}

const WITH_ARTICLE = article("<p>First para.</p><p>Second para.</p>");
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
      ].join("\n\n"),
    );

    const { state, restoredPlaceholders } = replaceStateFromMarkdown(
      WITH_ARTICLE,
      ARTICLE_MARKDOWN,
    );

    expect(types(state)).toEqual(["paragraph", "article"]);
    expect(placeholders(state)).toEqual(placeholders(WITH_ARTICLE));
    expect(restoredPlaceholders).toBe(1);
  });

  test("prose the caller edited is kept whole, never partly dropped", () => {
    const { state } = replaceStateFromMarkdown(
      WITH_ARTICLE,
      ARTICLE_MARKDOWN.replace("Second para.", "Second para, edited."),
    );

    expect(types(state)).toEqual([
      "paragraph",
      "article",
      "heading",
      "paragraph",
      "paragraph",
    ]);
    expect(JSON.stringify(state.root.children)).toContain(
      "Second para, edited.",
    );
  });

  test("prose the caller wrote under the placeholder is content", () => {
    const { state } = replaceStateFromMarkdown(
      WITH_ARTICLE,
      [
        "<!-- lexidraw:article#1 On splitting nodes -->",
        "### My own heading",
        "My own notes.",
      ].join("\n\n"),
    );

    expect(types(state)).toEqual(["article", "heading", "paragraph"]);
  });

  test("a list the caller wrote after an article is not absorbed", () => {
    // The derived prose is bullets too, so parsing it next to the caller's
    // list would merge the two and copy the article's on every cycle.
    const bulleted = article("<p>- One</p><p>- Two</p>", "- mine\n- also mine");

    let state = bulleted;
    let markdown = editorStateToMarkdown(state);
    for (let cycle = 0; cycle < 4; cycle += 1) {
      state = replaceStateFromMarkdown(state, markdown).state;
      expect(editorStateToMarkdown(state)).toBe(markdown);
      markdown = editorStateToMarkdown(state);
    }
    expect(types(state)).toEqual(types(bulleted));
    expect(placeholders(state)).toEqual(placeholders(bulleted));
  });

  test("an article body holding a code fence is a fixed point", () => {
    const fenced = article("<p>Run ```bun test``` twice.</p>");
    const markdown = editorStateToMarkdown(fenced);

    const { state } = replaceStateFromMarkdown(fenced, markdown);

    expect(types(state)).toEqual(["paragraph", "article"]);
    expect(editorStateToMarkdown(state)).toBe(markdown);
  });
});

test("replace preserves dragged widths only at the same table position and column count", () => {
  const md = "Intro.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
  const stored = markdownToEditorState(md);
  const table = stored.root.children[1];
  if (!table) throw new Error("Expected table");
  Object.assign(table, { colWidths: [210, 360] });
  const kept = replaceStateFromMarkdown(stored, md.replace("1 | 2", "3 | 4"));
  expect(kept.state.root.children[1]).toHaveProperty("colWidths", [210, 360]);
  const changed = replaceStateFromMarkdown(
    stored,
    "Intro.\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |",
  );
  expect(changed.state.root.children[1]).toHaveProperty("colWidths", undefined);
  const moved = replaceStateFromMarkdown(stored, `New block.\n\n${md}`);
  expect(moved.state.root.children[2]).toHaveProperty("colWidths", undefined);
  expect(stored.root.children[1]).toHaveProperty("colWidths", [210, 360]);
});

describe("replaceStateFromMarkdown keeps structure", () => {
  const STRUCTURED = stateOf(() => {
    const layout = LayoutContainerNode.$createLayoutContainerNode("1fr 3fr");
    layout.append(
      LayoutItemNode.$createLayoutItemNode().append(
        $createParagraphNode().append($createTextNode("Left")),
        VideoNode.$createVideoNode({ src: "https://example.com/clip.mp4" }),
      ),
      LayoutItemNode.$createLayoutItemNode().append(
        $createParagraphNode().append($createTextNode("Right")),
      ),
    );
    const details = CollapsibleContainerNode.$createCollapsibleContainerNode(
      false,
    ).append(
      CollapsibleTitleNode.$createCollapsibleTitleNode().append(
        $createTextNode("More"),
      ),
      CollapsibleContentNode.$createCollapsibleContentNode().append(
        $createParagraphNode().append($createTextNode("Hidden body")),
        YouTubeNode.$createYouTubeNode("dQw4w9WgXcQ"),
      ),
    );
    const callout = CalloutNode.$createCalloutNode("tip", "Faster").append(
      $createParagraphNode().append($createTextNode("Use the air fryer.")),
    );
    $getRoot().append(
      $createHeadingNode("h1").append($createTextNode("Title")),
      layout,
      details,
      callout,
    );
  });

  test("read then replace leaves columns, collapsibles and callouts intact", () => {
    const markdown = editorStateToMarkdown(STRUCTURED);
    expect(markdown).toContain("<columns>");
    expect(markdown).toContain("<details>");
    expect(markdown).toContain("> [!TIP] Faster");

    const { state, restoredPlaceholders, removedPlaceholders } =
      replaceStateFromMarkdown(STRUCTURED, markdown);

    expect(restoredPlaceholders).toBe(2);
    expect(removedPlaceholders).toBe(0);
    expect(JSON.stringify(state)).toBe(JSON.stringify(STRUCTURED));
  });

  test("column widths stay only at the same position and column count", () => {
    const markdown = editorStateToMarkdown(STRUCTURED);
    const edited = replaceStateFromMarkdown(
      STRUCTURED,
      markdown.replace("Right", "Right, edited"),
    );
    expect(edited.state.root.children[1]).toMatchObject({
      templateColumns: "1fr 3fr",
    });
    const moved = replaceStateFromMarkdown(STRUCTURED, `Intro.\n\n${markdown}`);
    expect(moved.state.root.children[2]).toMatchObject({
      templateColumns: "1fr 1fr",
    });
  });
});
