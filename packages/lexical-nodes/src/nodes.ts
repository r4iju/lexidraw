import { DocumentCodeNode } from "./nodes/DocumentCodeNode.js";
import { CodeHighlightNode } from "@lexical/code";
import { HorizontalRuleNode } from "@lexical/extension";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { MarkNode } from "@lexical/mark";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import type { Klass, LexicalNode } from "lexical";
import { ArticleNode } from "./nodes/ArticleNode.js";
import { AutocompleteNode } from "./nodes/AutocompleteNode.js";
import { ChartNode } from "./nodes/ChartNode.js";
import { CollapsibleContainerNode } from "./nodes/CollapsibleContainerNode.js";
import { CollapsibleContentNode } from "./nodes/CollapsibleContentNode.js";
import { CollapsibleTitleNode } from "./nodes/CollapsibleTitleNode.js";
import { CommentNode } from "./nodes/CommentNode.js";
import { EquationNode } from "./nodes/EquationNode.js";
import { ExcalidrawNode } from "./nodes/ExcalidrawNode.js";
import { FigmaNode } from "./nodes/FigmaNode.js";
import { ImageNode } from "./nodes/ImageNode.js";
import { InlineImageNode } from "./nodes/InlineImageNode.js";
import { LayoutContainerNode } from "./nodes/LayoutContainerNode.js";
import { LayoutItemNode } from "./nodes/LayoutItemNode.js";
import { MermaidNode } from "./nodes/MermaidNode.js";
import { PageBreakNode } from "./nodes/PageBreakNode.js";
import { PollNode } from "./nodes/PollNode.js";
import { SlideNode } from "./nodes/SlideNode.js";
import { StickyNode } from "./nodes/StickyNode.js";
import { ThreadNode } from "./nodes/ThreadNode.js";
import { TweetNode } from "./nodes/TweetNode.js";
import { VideoNode } from "./nodes/VideoNode.js";
import { YouTubeNode } from "./nodes/YouTubeNode.js";

/**
 * Every node class the document editor registers. The server's headless
 * editor registers exactly these, so a document is readable as markdown iff
 * every node type it stores is in this list (or a Lexical built-in). The
 * browser editor registers these and then its React subclasses of the
 * decorator nodes, which take over their types. Nodes the editor does not
 * register (emoji, keyword, mention) are exported by the package but
 * deliberately absent here.
 */
export const CORE_NODES: Klass<LexicalNode>[] = [
  HeadingNode,
  QuoteNode,
  ListItemNode,
  ListNode,
  HorizontalRuleNode,
  MarkNode,
  DocumentCodeNode,
  CodeHighlightNode,
  TableNode,
  TableCellNode,
  TableRowNode,
  AutocompleteNode,
  LinkNode,
  AutoLinkNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
  LayoutContainerNode,
  LayoutItemNode,
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
];
