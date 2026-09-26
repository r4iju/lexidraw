/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { SCHEMA_NODES } from "@packages/lexical-nodes";
import { ArticleNode } from "./ArticleNode/ArticleNode";
import { ChartNode } from "./ChartNode";
import { CommentNode } from "./CommentNode";
import { EquationNode } from "./EquationNode";
import { ExcalidrawNode } from "./ExcalidrawNode";
import { FigmaNode } from "./FigmaNode";
import { FootnoteReferenceNode } from "./FootnoteNode";
import { ImageNode } from "./ImageNode/ImageNode";
import { InlineImageNode } from "./InlineImageNode/InlineImageNode";
import { MermaidNode } from "./MermaidNode";
import { PageBreakNode } from "./PageBreakNode";
import { PollNode } from "./PollNode";
import { SlideNode } from "./SlideNode/SlideNode";
import { StickyNode } from "./StickyNode";
import { ThreadNode } from "./ThreadNode";
import { TweetNode } from "./TweetNode";
import { VideoNode } from "./VideoNode/VideoNode";
import { YouTubeNode } from "./YouTubeNode";

const EVERY_NODE = await Bun.file(
  new URL(
    "../../../../../../../packages/lexical-nodes/test/every-node.json",
    import.meta.url,
  ),
).json();

test("the React halves read and write a stored document as the package's nodes do", () => {
  const editor = createHeadlessEditor({
    nodes: [
      ...SCHEMA_NODES,
      CommentNode,
      ThreadNode,
      FootnoteReferenceNode,
      PageBreakNode,
      PollNode,
      StickyNode,
      ImageNode,
      InlineImageNode,
      VideoNode,
      YouTubeNode,
      TweetNode,
      FigmaNode,
      EquationNode,
      MermaidNode,
      ChartNode,
      ExcalidrawNode,
      SlideNode,
      ArticleNode,
    ],
    onError: (error) => {
      throw error;
    },
  });

  editor.setEditorState(editor.parseEditorState(EVERY_NODE));

  expect(JSON.parse(JSON.stringify(editor.getEditorState()))).toEqual(
    EVERY_NODE,
  );
  for (const node of editor.getEditorState()._nodeMap.values()) {
    expect(Object.getPrototypeOf(node)).toBe(
      editor._nodes.get(node.getType())?.klass.prototype,
    );
  }
});
