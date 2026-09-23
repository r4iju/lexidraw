/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  type LexicalEditor,
} from "lexical";
import {
  ARTICLE,
  ArticleNode,
  ChartNode,
  CommentNode,
  CORE_NODES,
  CORE_TRANSFORMERS,
  EquationNode,
  ExcalidrawNode,
  FigmaNode,
  ImageNode,
  InlineImageNode,
  MermaidNode,
  PageBreakNode,
  PollNode,
  SlideNode,
  StickyNode,
  ThreadNode,
  TweetNode,
  VideoNode,
  YouTubeNode,
} from "./index.js";

function editorWithCoreNodes(): LexicalEditor {
  return createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
}

function toMarkdown(editor: LexicalEditor): string {
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(CORE_TRANSFORMERS, $getRoot()));
}

function fromMarkdown(editor: LexicalEditor, markdown: string): void {
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, CORE_TRANSFORMERS);
    },
    { discrete: true },
  );
}

describe("decorator node markdown", () => {
  test("images, equations, and tweets keep their markdown forms", () => {
    const editor = editorWithCoreNodes();
    fromMarkdown(
      editor,
      'Look ![a cat](https://example.com/cat.png) and $E=mc^2$\n\n<tweet id="123" />',
    );
    editor.getEditorState().read(() => {
      const [paragraph, tweet] = $getRoot().getChildren();
      expect($isParagraphNode(paragraph)).toBe(true);
      const types = (paragraph as ReturnType<typeof $createParagraphNode>)
        .getChildren()
        .map((child) => child.getType());
      expect(types).toEqual(["text", "image", "text", "equation"]);
      expect(TweetNode.$isTweetNode(tweet)).toBe(true);
    });
    expect(toMarkdown(editor)).toBe(
      'Look ![a cat](https://example.com/cat.png) and $E=mc^2$\n\n<tweet id="123" />',
    );
  });

  test("nodes without a markdown form export as ordinal placeholders", () => {
    const editor = editorWithCoreNodes();
    editor.update(
      () => {
        const root = $getRoot();
        const first = $createParagraphNode();
        first.append(
          $createTextNode("before "),
          InlineImageNode.$createInlineImageNode({
            altText: "logo",
            src: "https://example.com/logo.png",
          }),
          $createTextNode(" after "),
          ChartNode.$createChartNode({ chartType: "pie" }),
        );
        root.append(
          first,
          VideoNode.$createVideoNode({ src: "https://example.com/clip.mp4" }),
          YouTubeNode.$createYouTubeNode("dQw4w9WgXcQ"),
          FigmaNode.$createFigmaNode("abc"),
          PageBreakNode.$createPageBreakNode(),
          StickyNode.$createStickyNode(0, 0),
          $createParagraphNode().append(
            PollNode.$createPollNode("Lunch?", [
              PollNode.createPollOption("Pizza"),
            ]),
          ),
          $createParagraphNode().append(
            ChartNode.$createChartNode({ chartType: "bar" }),
          ),
        );
      },
      { discrete: true },
    );

    expect(toMarkdown(editor)).toBe(
      [
        "before <!-- lexidraw:inline-image#1 ![logo](https://example.com/logo.png) --> after <!-- lexidraw:chart#1 pie -->",
        "<!-- lexidraw:video#1 https://example.com/clip.mp4 -->",
        "<!-- lexidraw:youtube#1 https://www.youtube.com/watch?v=dQw4w9WgXcQ -->",
        "<!-- lexidraw:figma#1 https://www.figma.com/file/abc -->",
        "<!-- lexidraw:page-break#1 -->",
        "<!-- lexidraw:sticky#1 -->",
        "<!-- lexidraw:poll#1 Lunch? -->",
        "<!-- lexidraw:chart#2 bar -->",
      ].join("\n\n"),
    );
  });

  test("the heavy decorator nodes summarise their contents", () => {
    const editor = editorWithCoreNodes();
    editor.update(
      () => {
        $getRoot().append(
          SlideNode.$createSlideNode({
            slides: [
              { id: "s1", elements: [] },
              {
                id: "s2",
                elements: [],
                slideMetadata: { storyboardTitle: "Why now" },
              },
              {
                id: "s3",
                elements: [],
                slideMetadata: { storyboardTitle: "The ask" },
              },
            ],
            currentSlideId: "s1",
          }),
          SlideNode.$createSlideNode({ slides: [], currentSlideId: null }),
          $createParagraphNode().append(
            MermaidNode.$createMermaidNode("\n\nflowchart LR\n  A --> B"),
          ),
          $createParagraphNode().append(
            new CommentNode({
              author: "ada",
              content: "Tighten this paragraph",
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
          ),
        );
      },
      { discrete: true },
    );

    expect(toMarkdown(editor)).toBe(
      [
        "<!-- lexidraw:slide-deck#1 3 slides: Why now / The ask -->",
        "<!-- lexidraw:slide-deck#2 0 slides -->",
        "<!-- lexidraw:mermaid#1 flowchart LR -->",
        "<!-- lexidraw:comment#1 Tighten this paragraph --><!-- lexidraw:thread#1 the quoted text -->",
      ].join("\n\n"),
    );
  });

  test("an excalidraw placeholder counts elements in either stored shape", () => {
    const editor = editorWithCoreNodes();
    editor.update(
      () => {
        const scene = ExcalidrawNode.$createExcalidrawNode();
        scene.setData(
          JSON.stringify({
            elements: [{ id: "a" }, { id: "b" }],
            files: {},
            appState: {},
          }),
        );
        const legacy = ExcalidrawNode.$createExcalidrawNode();
        legacy.setData(JSON.stringify([{ id: "a" }]));
        const unparseable = ExcalidrawNode.$createExcalidrawNode();
        unparseable.setData("not json");
        $getRoot().append(
          $createParagraphNode().append(scene),
          $createParagraphNode().append(legacy),
          $createParagraphNode().append(unparseable),
          // The default data is the empty legacy array.
          $createParagraphNode().append(ExcalidrawNode.$createExcalidrawNode()),
        );
      },
      { discrete: true },
    );

    expect(toMarkdown(editor)).toBe(
      [
        "<!-- lexidraw:excalidraw#1 2 elements -->",
        "<!-- lexidraw:excalidraw#2 1 elements -->",
        "<!-- lexidraw:excalidraw#3 0 elements -->",
        "<!-- lexidraw:excalidraw#4 0 elements -->",
      ].join("\n\n"),
    );
  });

  test("an article exports as markdown, not as a placeholder", () => {
    const editor = editorWithCoreNodes();
    editor.update(
      () => {
        $getRoot().append(
          ArticleNode.$createArticleNode({
            mode: "url",
            url: "https://example.com/post",
            distilled: {
              title: "On splitting nodes",
              contentHtml: "<p>First para.</p><p>Second para.</p>",
            },
          }),
        );
      },
      { discrete: true },
    );

    expect(CORE_TRANSFORMERS).toContain(ARTICLE);
    expect(toMarkdown(editor)).toBe(
      "### On splitting nodes\n\n[Source](https://example.com/post)\n\nFirst para.\nSecond para.",
    );
  });

  test("a placeholder summary cannot close the comment early", () => {
    const editor = editorWithCoreNodes();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            PollNode.$createPollNode("a -->\n b", []),
          ),
          $createParagraphNode().append(
            PollNode.$createPollNode("a ---->> b", []),
          ),
        );
      },
      { discrete: true },
    );
    expect(toMarkdown(editor)).toBe(
      "<!-- lexidraw:poll#1 a -> b -->\n\n<!-- lexidraw:poll#2 a ->> b -->",
    );
  });

  test("markdown inside a placeholder summary is not parsed", () => {
    const editor = editorWithCoreNodes();
    const input = [
      "<!-- lexidraw:inline-image#1 ![logo](https://example.com/logo.png) -->",
      "see <!-- lexidraw:poll#1 Cost $5 or $10? --> and ![real](https://example.com/r.png) plus $a$",
    ].join("\n\n");
    fromMarkdown(editor, input);
    editor.getEditorState().read(() => {
      const [first, second] = $getRoot().getChildren();
      expect($isParagraphNode(first) && $isParagraphNode(second)).toBe(true);
      const paragraphs = [first, second] as ReturnType<
        typeof $createParagraphNode
      >[];
      expect(paragraphs[0]?.getChildren().map((c) => c.getType())).toEqual([
        "text",
      ]);
      expect(paragraphs[0]?.getTextContent()).toBe(input.split("\n\n")[0]);
      expect(paragraphs[1]?.getChildren().map((c) => c.getType())).toEqual([
        "text",
        "image",
        "text",
        "equation",
      ]);
      expect(paragraphs[1]?.getTextContent()).toContain(
        "see <!-- lexidraw:poll#1 Cost $5 or $10? --> and ",
      );
    });
  });

  test("placeholders import as literal text, never as nodes", () => {
    const editor = editorWithCoreNodes();
    const input =
      "<!-- lexidraw:video#1 https://example.com/clip.mp4 -->\n\nsee <!-- lexidraw:chart#1 pie --> here";
    fromMarkdown(editor, input);
    editor.getEditorState().read(() => {
      const children = $getRoot().getChildren();
      expect(children.map((child) => child.getType())).toEqual([
        "paragraph",
        "paragraph",
      ]);
      expect(children[0]?.getTextContent()).toBe(
        "<!-- lexidraw:video#1 https://example.com/clip.mp4 -->",
      );
      expect(children[1]?.getTextContent()).toBe(
        "see <!-- lexidraw:chart#1 pie --> here",
      );
    });
  });

  test("importJSON fills in the constructor defaults for missing fields", () => {
    const editor = editorWithCoreNodes();
    editor.update(
      () => {
        const drawing = ExcalidrawNode.importJSON({
          type: "excalidraw",
          version: 1,
        } as never);
        expect(drawing.getData()).toBe("[]");
        expect(drawing.getWidth()).toBe("inherit");
        expect(drawing.getHeight()).toBe("inherit");
        const article = ArticleNode.importJSON({
          type: "article",
          version: 1,
          data: { mode: "entity", entityId: "e1" },
        } as never);
        expect(article.exportJSON().format).toBe("");
      },
      { discrete: true },
    );
  });

  test("every node in the list is registered under its own type", () => {
    const editor = editorWithCoreNodes();
    for (const klass of [
      ImageNode,
      InlineImageNode,
      VideoNode,
      YouTubeNode,
      TweetNode,
      FigmaNode,
      EquationNode,
      PageBreakNode,
      StickyNode,
      PollNode,
      ChartNode,
      SlideNode,
      ExcalidrawNode,
      MermaidNode,
      ArticleNode,
      CommentNode,
      ThreadNode,
    ]) {
      expect(editor.hasNode(klass)).toBe(true);
    }
  });
});
