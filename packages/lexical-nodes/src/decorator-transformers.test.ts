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
  ChartNode,
  CORE_NODES,
  CORE_TRANSFORMERS,
  EquationNode,
  FigmaNode,
  ImageNode,
  InlineImageNode,
  PageBreakNode,
  PollNode,
  StickyNode,
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

  test("a placeholder summary cannot close the comment early", () => {
    const editor = editorWithCoreNodes();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            PollNode.$createPollNode("a -->\n b", []),
          ),
        );
      },
      { discrete: true },
    );
    expect(toMarkdown(editor)).toBe("<!-- lexidraw:poll#1 a b -->");
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
    ]) {
      expect(editor.hasNode(klass)).toBe(true);
    }
  });
});
