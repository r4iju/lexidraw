import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
} from "./base-schemas.js";

// Core insertion helpers
export const InsertSlideDeckNodeSchema = z.object({
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

export const InsertHeadingNodeSchema = z.object({
  text: z.string(),
  tag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

export const InsertTextNodeSchema = z.object({
  text: z.string(),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

export const ApplyTextStyleSchema = z.object({
  anchorKey: z.string().optional(),
  editorKey: EditorKeySchema.optional(),
  fontFamily: z.string().optional(),
  fontSize: z.string().optional(),
  fontWeight: z.string().optional(),
  fontStyle: z.string().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
});

export const InsertListNodeSchema = z.object({
  listType: z.enum(["bullet", "number", "check"]),
  text: z.string(),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

export const InsertListItemNodeSchema = z.object({
  text: z.string(),
  relation: z
    .enum(["before", "after", "appendToList"])
    .describe(
      "'before'/'after' relative to an existing ListItemNode; 'appendToList' adds to end of a ListNode.",
    ),
  anchor: z.discriminatedUnion("type", [
    z.object({ type: z.literal("key"), key: z.string() }),
    z.object({ type: z.literal("text"), text: z.string() }),
  ]),
  editorKey: EditorKeySchema.optional(),
});

// Markdown
export const InsertMarkdownSchema = z.object({
  markdownText: z.string(),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

// Collapsible
export const InsertCollapsibleSectionSchema = z.object({
  titleText: z.string(),
  initialContentMarkdown: z.string().optional(),
  initiallyOpen: z.boolean().optional().default(false),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

// Code
export const InsertCodeBlockSchema = z.object({
  language: z.string().optional(),
  initialText: z.string().optional(),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

export const InsertCodeHighlightNodeSchema = z.object({
  text: z.string(),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

// Table
export const InsertTableSchema = z.object({
  rows: z.number().min(1),
  columns: z.number().min(1),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

// Link
export const InsertLinkNodeSchema = z.object({
  url: z.string(),
  linkText: z.string().optional(),
  attributes: z
    .object({
      rel: z.string().optional(),
      target: z.string().optional(),
      title: z.string().optional(),
    })
    .optional(),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

// Layout
export const InsertLayoutSchema = z.object({
  templateColumns: z.string(),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

// Equation
export const InsertEquationNodeSchema = z.object({
  equation: z.string(),
  inline: z.boolean().optional().default(false),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

// Web
export const ExtractWebpageContentSchema = z.object({
  url: z.url(),
  maxChars: z.number().int().min(200).max(20000).optional(),
});

// Diagram
export const InsertExcalidrawDiagramSchema = z.object({
  mermaidLines: z.array(z.string()).nonempty(),
  mermaidConfig: z.object({}).passthrough().optional(),
  excalidrawConfig: z
    .object({ fontSize: z.number().optional() })
    .passthrough()
    .optional(),
  width: z
    .union([z.number().min(100), z.literal("inherit")])
    .optional()
    .default("inherit"),
  height: z
    .union([z.number().min(100), z.literal("inherit")])
    .optional()
    .default("inherit"),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

export const InsertMermaidDiagramSchema = z.object({
  mermaidLines: z.array(z.string()).nonempty(),
  width: z
    .union([z.number().min(100), z.literal("inherit")])
    .optional()
    .default("inherit"),
  height: z
    .union([z.number().min(100), z.literal("inherit")])
    .optional()
    .default("inherit"),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

// Poll
export const InsertPollNodeSchema = z.object({
  question: z.string(),
  optionTexts: z.array(z.string()).min(1),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

// Media embeds
export const InsertTweetNodeSchema = z.object({
  tweetID: z.string().regex(/^\d+$/, "Tweet ID must be a string of digits."),
  format: z.enum(["left", "center", "right", "justify"]).optional(),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

export const InsertYouTubeNodeSchema = z.object({
  videoID: z.string(),
  format: z.enum(["left", "center", "right", "justify"]).optional(),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

export const InsertFigmaNodeSchema = z.object({
  documentID: z.string(),
  format: z.enum(["left", "center", "right", "justify"]).optional(),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

export const InsertPageBreakNodeSchema = z.object({
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

export const InsertHashtagSchema = z.object({
  text: z.string(),
  relation: InsertionRelationSchema,
  anchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

// Image
export const SearchAndInsertImageSchema = z.object({
  query: z.string(),
});

export const GenerateAndInsertImageSchema = z.object({
  prompt: z.string(),
});

// Comment
export const FindAndSelectTextForCommentSchema = z.object({
  textToFind: z.string().min(1),
  editorKey: EditorKeySchema.optional(),
});

export const AddCommentThreadSchema = z.object({
  initialCommentText: z.string(),
  authorName: z.string().optional(),
  threadNodePlacementRelation:
    InsertionRelationSchema.optional().default("appendRoot"),
  threadNodePlacementAnchor: InsertionAnchorSchema.optional(),
  editorKey: EditorKeySchema.optional(),
});

export const AddReplyToThreadSchema = z.object({
  threadId: z.string(),
  replyText: z.string(),
  authorName: z.string().optional(),
  editorKey: EditorKeySchema.optional(),
});

export const RemoveCommentFromThreadSchema = z.object({
  threadId: z.string(),
  commentId: z.string(),
  editorKey: EditorKeySchema.optional(),
});

export const RemoveCommentThreadSchema = z.object({
  threadId: z.string(),
});

// Slides: structure-only shapes (no app-specific types)
export const AddSlidePageSchema = z.object({
  deckNodeKey: z.string(),
  newSlideId: z.string().optional(),
  insertionIndex: z.number().int().min(0).optional(),
  focusNewSlide: z.boolean().optional().default(true),
  backgroundColor: z.string().optional(),
  // slideMetadata intentionally omitted here to stay app-agnostic; keep local if needed
  editorKey: EditorKeySchema.optional(),
});

export const RemoveSlidePageSchema = z.object({
  deckNodeKey: z.string(),
  slideIdToRemove: z.string(),
  editorKey: EditorKeySchema.optional(),
});

export const ReorderSlidePageSchema = z.object({
  deckNodeKey: z.string(),
  slideIdToMove: z.string(),
  newIndex: z.number().int().min(0),
  editorKey: EditorKeySchema.optional(),
});

export const SetSlidePageBackgroundSchema = z.object({
  deckNodeKey: z.string(),
  slideTarget: z.union([
    z.object({ type: z.literal("id"), slideId: z.string() }),
    z.object({ type: z.literal("index"), slideIndex: z.number().int().min(0) }),
  ]),
  backgroundColor: z.string(),
  editorKey: EditorKeySchema.optional(),
});

export const AddImageToSlidePageSchema = z.object({
  deckNodeKey: z.string(),
  slideId: z.string(),
  imageUrl: z.string(),
  imageId: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  editorKey: EditorKeySchema.optional(),
});

export const SearchAndAddImageToSlidePageSchema = z.object({
  deckNodeKey: z.string(),
  slideId: z.string(),
  query: z.string(),
});

export const GenerateAndAddImageToSlidePageSchema = z.object({
  deckNodeKey: z.string(),
  slideId: z.string(),
  prompt: z.string(),
});

export const AddChartToSlidePageSchema = z.object({
  deckNodeKey: z.string(),
  slideId: z.string(),
  chartType: z.enum(["bar", "line", "pie"]).default("bar"),
  chartData: z.any(),
  chartConfig: z.any(),
  chartId: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  editorKey: EditorKeySchema.optional(),
});

export const AddBoxToSlidePageSchema = z.object({
  deckNodeKey: z.string(),
  slideId: z.string(),
  boxId: z.string().optional(),
  editorKey: EditorKeySchema.optional(),
});

export const UpdateElementPropertiesSchema = z.object({
  deckNodeKey: z.string(),
  slideId: z.string(),
  elementId: z.string(),
  kind: z.enum(["box", "image", "chart"]),
  properties: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.union([z.number(), z.literal("inherit")]).optional(),
    height: z.union([z.number(), z.literal("inherit")]).optional(),
    zIndex: z.number().optional(),
    backgroundColor: z.string().optional(),
    url: z.string().optional(),
    chartType: z.enum(["bar", "line", "pie"]).optional(),
    chartData: z.any().optional(),
    chartConfig: z.any().optional(),
  }),
  editorKey: EditorKeySchema.optional(),
});

export const SaveStoryboardOutputSchema = z.object({
  slides: z.array(
    z.object({
      slideNumber: z.number().int().positive(),
      title: z.string(),
      keyMessage: z.string(),
      visualIdea: z.string(),
      speakerNotes: z.string(),
    }),
  ),
});

export const SaveSlideContentAndMetadataSchema = z.object({
  deckNodeKey: z.string(),
  slideId: z.string(),
  bodyContent: z.array(
    z.object({
      type: z.string(),
      text: z.string(),
    }),
  ),
  refinedSpeakerNotes: z.string(),
  editorKey: EditorKeySchema.optional(),
});
