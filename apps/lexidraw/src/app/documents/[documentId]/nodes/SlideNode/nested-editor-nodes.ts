import { HashtagNode } from "@lexical/hashtag";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { MarkNode } from "@lexical/mark";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import {
  AutocompleteNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
  CORE_NODES,
  EmojiNode,
  KeywordNode,
  LayoutContainerNode,
  LayoutItemNode,
} from "@packages/lexical-nodes";
import { LineBreakNode, ParagraphNode, TextNode } from "lexical";
import { ArticleNode } from "../ArticleNode/ArticleNode";
import { ChartNode } from "../ChartNode";
import { CommentNode } from "../CommentNode";
import { EquationNode } from "../EquationNode";
import { ExcalidrawNode } from "../ExcalidrawNode";
import { FigmaNode } from "../FigmaNode";
import { ImageNode } from "../ImageNode/ImageNode";
import { InlineImageNode } from "../InlineImageNode/InlineImageNode";
import { MermaidNode } from "../MermaidNode";
import { PageBreakNode } from "../PageBreakNode";
import { PollNode } from "../PollNode";
import { StickyNode } from "../StickyNode";
import { ThreadNode } from "../ThreadNode";
import { TweetNode } from "../TweetNode";
import { VideoNode } from "../VideoNode/VideoNode";
import { YouTubeNode } from "../YouTubeNode";
import { SlideNode } from "./SlideNode";

/**
 * What a slide's text boxes can hold. Apart from the slide editor, so a
 * document can know them without loading the editor and its charts.
 */
export const NESTED_EDITOR_NODES = [
  // Every transformer in PLAYGROUND_TRANSFORMERS depends on a node in this
  // set, and MarkdownShortcutPlugin runs in here too; the React subclasses
  // after it take over their types, as in document-editor.
  ...CORE_NODES,
  SlideNode,
  ArticleNode,
  ChartNode,
  MarkNode,
  AutocompleteNode,
  CommentNode,
  ThreadNode,
  PageBreakNode,
  StickyNode,
  MermaidNode,
  HeadingNode,
  QuoteNode,
  ListItemNode,
  ListNode,
  LinkNode,
  ParagraphNode,
  TextNode,
  LineBreakNode,
  KeywordNode,
  HashtagNode,
  EmojiNode,
  ImageNode,
  InlineImageNode,
  VideoNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  AutoLinkNode,
  HorizontalRuleNode,
  EquationNode,
  TweetNode,
  YouTubeNode,
  ExcalidrawNode,
  FigmaNode,
  LayoutContainerNode,
  LayoutItemNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
  PollNode,
];
