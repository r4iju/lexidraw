import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { CORE_NODES } from "@packages/lexical-nodes";
import type { Klass, LexicalNode } from "lexical";
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

/** The nodes the document editor registers. */
export const DOCUMENT_NODES: Klass<LexicalNode>[] = [
  ...CORE_NODES,
  // The classes below share their types with headless nodes in CORE_NODES.
  // Lexical keeps the last class registered per type and instantiates it
  // everywhere (importJSON, markdown import, $create), so listing the React
  // subclasses after the core set gives every node its component.
  HorizontalRuleNode,
  SlideNode,
  CommentNode,
  ThreadNode,
  ImageNode,
  InlineImageNode,
  VideoNode,
  TweetNode,
  YouTubeNode,
  ExcalidrawNode,
  MermaidNode,
  ChartNode,
  FigmaNode,
  EquationNode,
  PageBreakNode,
  PollNode,
  StickyNode,
  ArticleNode,
  FootnoteReferenceNode,
];
