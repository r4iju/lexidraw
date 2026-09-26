/**
 * The `Serialized*Node` types are written out by hand: derived from a node's
 * schema fields, a declaration file would have to spell out those fields'
 * types, which name Lexical types it doesn't export. So they're checked here
 * against what the fields write instead, which `test:ts` does.
 */
import { expect, test } from "bun:test";
import type { Spread } from "lexical";
import type {
  ArticleFieldsJSON,
  SerializedArticleNode,
} from "./nodes/ArticleNode.js";
import type {
  AutocompleteFieldsJSON,
  SerializedAutocompleteNode,
} from "./nodes/AutocompleteNode.js";
import type {
  CalloutFieldsJSON,
  SerializedCalloutNode,
} from "./nodes/CalloutNode.js";
import type {
  ChartFieldsJSON,
  SerializedChartNode,
} from "./nodes/ChartNode.js";
import type {
  CommentFieldsJSON,
  SerializedCommentNode,
} from "./nodes/CommentNode.js";
import type {
  EmojiFieldsJSON,
  SerializedEmojiNode,
} from "./nodes/EmojiNode.js";
import type {
  EquationFieldsJSON,
  SerializedEquationNode,
} from "./nodes/EquationNode.js";
import type {
  ExcalidrawFieldsJSON,
  SerializedExcalidrawNode,
} from "./nodes/ExcalidrawNode.js";
import type {
  FigmaFieldsJSON,
  SerializedFigmaNode,
} from "./nodes/FigmaNode.js";
import type {
  FootnoteDefinitionFieldsJSON,
  FootnoteReferenceFieldsJSON,
  SerializedFootnoteDefinitionNode,
  SerializedFootnoteReferenceNode,
} from "./nodes/FootnoteNode.js";
import type {
  ImageFieldsJSON,
  SerializedImageNode,
} from "./nodes/ImageNode.js";
import type {
  InlineImageFieldsJSON,
  SerializedInlineImageNode,
} from "./nodes/InlineImageNode.js";
import type {
  LayoutContainerFieldsJSON,
  SerializedLayoutContainerNode,
} from "./nodes/LayoutContainerNode.js";
import type {
  MarkerFieldsJSON,
  SerializedMarkerNode,
} from "./nodes/MarkerNode.js";
import type {
  MentionFieldsJSON,
  SerializedMentionNode,
} from "./nodes/MentionNode.js";
import type {
  MermaidFieldsJSON,
  SerializedMermaidNode,
} from "./nodes/MermaidNode.js";
import type { PollFieldsJSON, SerializedPollNode } from "./nodes/PollNode.js";
import type {
  SerializedSlideDeckNode,
  SlideFieldsJSON,
} from "./nodes/SlideNode.js";
import type {
  SerializedStickyNode,
  StickyFieldsJSON,
} from "./nodes/StickyNode.js";
import type {
  SerializedThreadNode,
  ThreadFieldsJSON,
} from "./nodes/ThreadNode.js";
import type {
  SerializedTweetNode,
  TweetFieldsJSON,
} from "./nodes/TweetNode.js";
import type {
  SerializedVideoNode,
  VideoFieldsJSON,
} from "./nodes/VideoNode.js";
import type {
  SerializedYouTubeNode,
  YouTubeFieldsJSON,
} from "./nodes/YouTubeNode.js";
import type { SerializedDecoratorBlockNode } from "@lexical/react/LexicalDecoratorBlockNode";
import type {
  SerializedElementNode,
  SerializedLexicalNode,
  SerializedTextNode,
} from "lexical";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type Flat<T> = { [K in keyof T]: T[K] };

/**
 * Whether `Serialized` is `Base` with `Fields` written over it, key for key and
 * type for type. The node's `type` and `version` are Lexical's to write, and
 * aren't among its fields.
 */
type WritesItsFields<Serialized, Fields, Base> = Equal<
  Flat<Omit<Serialized, "type" | "version">>,
  Flat<Omit<Spread<Fields, Base>, "type" | "version">>
>;

test("each node's JSON type is what its schema fields write", () => {
  const written: [
    WritesItsFields<
      SerializedArticleNode,
      ArticleFieldsJSON,
      SerializedDecoratorBlockNode
    >,
    WritesItsFields<
      SerializedAutocompleteNode,
      AutocompleteFieldsJSON,
      SerializedTextNode
    >,
    WritesItsFields<
      SerializedCalloutNode,
      CalloutFieldsJSON,
      SerializedElementNode
    >,
    WritesItsFields<
      SerializedChartNode,
      ChartFieldsJSON,
      SerializedLexicalNode
    >,
    WritesItsFields<
      SerializedCommentNode,
      CommentFieldsJSON,
      SerializedMarkerNode
    >,
    WritesItsFields<SerializedEmojiNode, EmojiFieldsJSON, SerializedTextNode>,
    WritesItsFields<
      SerializedEquationNode,
      EquationFieldsJSON,
      SerializedLexicalNode
    >,
    WritesItsFields<
      SerializedExcalidrawNode,
      ExcalidrawFieldsJSON,
      SerializedLexicalNode
    >,
    WritesItsFields<
      SerializedFigmaNode,
      FigmaFieldsJSON,
      SerializedDecoratorBlockNode
    >,
    WritesItsFields<
      SerializedFootnoteDefinitionNode,
      FootnoteDefinitionFieldsJSON,
      SerializedElementNode
    >,
    WritesItsFields<
      SerializedFootnoteReferenceNode,
      FootnoteReferenceFieldsJSON,
      SerializedLexicalNode
    >,
    WritesItsFields<
      SerializedImageNode,
      ImageFieldsJSON,
      SerializedLexicalNode
    >,
    WritesItsFields<
      SerializedInlineImageNode,
      InlineImageFieldsJSON,
      SerializedLexicalNode
    >,
    WritesItsFields<
      SerializedLayoutContainerNode,
      LayoutContainerFieldsJSON,
      SerializedElementNode
    >,
    WritesItsFields<
      SerializedMarkerNode,
      MarkerFieldsJSON & { children: [] },
      SerializedLexicalNode
    >,
    WritesItsFields<
      SerializedMentionNode,
      MentionFieldsJSON,
      SerializedTextNode
    >,
    WritesItsFields<
      SerializedMermaidNode,
      MermaidFieldsJSON,
      SerializedLexicalNode
    >,
    WritesItsFields<SerializedPollNode, PollFieldsJSON, SerializedLexicalNode>,
    WritesItsFields<
      SerializedSlideDeckNode,
      SlideFieldsJSON,
      SerializedLexicalNode
    >,
    WritesItsFields<
      SerializedStickyNode,
      StickyFieldsJSON,
      SerializedLexicalNode
    >,
    WritesItsFields<
      SerializedThreadNode,
      ThreadFieldsJSON,
      SerializedMarkerNode
    >,
    WritesItsFields<
      SerializedTweetNode,
      TweetFieldsJSON,
      SerializedDecoratorBlockNode
    >,
    WritesItsFields<
      SerializedVideoNode,
      VideoFieldsJSON,
      SerializedLexicalNode
    >,
    WritesItsFields<
      SerializedYouTubeNode,
      YouTubeFieldsJSON,
      SerializedDecoratorBlockNode
    >,
  ] = [
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ];

  expect(written).not.toContain(false);
});
