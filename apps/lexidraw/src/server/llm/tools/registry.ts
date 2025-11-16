import { tool } from "ai";
import type { Tool } from "ai";
import { z, type ZodTypeAny } from "zod";
import {
  // Text & structure
  InsertMarkdownSchema,
  InsertHeadingNodeSchema,
  InsertTextNodeSchema,
  InsertListNodeSchema,
  InsertListItemNodeSchema,
  InsertTableSchema,
  InsertCodeBlockSchema,
  InsertCodeHighlightNodeSchema,
  ApplyTextStyleSchema,
  InsertHashtagSchema,
  // Links & equations
  InsertLinkNodeSchema,
  InsertEquationNodeSchema,
  // Layout & collapsible
  InsertLayoutSchema,
  InsertCollapsibleSectionSchema,
  InsertPageBreakNodeSchema,
  // Media & embeds
  InsertExcalidrawDiagramSchema,
  InsertMermaidDiagramSchema,
  InsertTweetNodeSchema,
  InsertYouTubeNodeSchema,
  InsertFigmaNodeSchema,
  // Slides
  InsertSlideDeckNodeSchema,
  AddSlidePageSchema,
  RemoveSlidePageSchema,
  ReorderSlidePageSchema,
  SetSlidePageBackgroundSchema,
  AddBoxToSlidePageSchema,
  AddImageToSlidePageSchema,
  AddChartToSlidePageSchema,
  // Comments
  FindAndSelectTextForCommentSchema,
  AddCommentThreadSchema,
  AddReplyToThreadSchema,
  RemoveCommentFromThreadSchema,
  RemoveCommentThreadSchema,
  // Image search/gen
  SearchAndInsertImageSchema,
  GenerateAndInsertImageSchema,
  // Content extraction
  ExtractWebpageContentSchema,
  // Updates & saves
  UpdateElementPropertiesSchema,
  SaveStoryboardOutputSchema,
  SaveSlideContentAndMetadataSchema,
  // Code execution
  ExecuteCodeSchema,
  ExecuteCodeClientSchema,
} from "@packages/types";

type ToolSpec = {
  description: string;
  inputSchema: ZodTypeAny;
  group: "client" | "server";
};

const TOOL_SPECS: Record<string, ToolSpec> = {
  // Messaging & meta
  requestClarificationOrPlan: {
    description:
      "Ask the user a clarifying question or propose a short plan before editing.",
    inputSchema: z.object({ question: z.string().min(1) }),
    group: "client",
  },
  sendReply: {
    description: "Send a short assistant reply without modifying the document.",
    inputSchema: z.object({ message: z.string().min(1) }),
    group: "client",
  },

  // Inserts: text & structure
  insertMarkdown: {
    description:
      "Insert content parsed from Markdown at a specified position in the document.",
    inputSchema: InsertMarkdownSchema,
    group: "client",
  },
  insertHeadingNode: {
    description: "Insert a heading node with given text and tag (h1..h6).",
    inputSchema: InsertHeadingNodeSchema,
    group: "client",
  },
  insertTextNode: {
    description: "Insert a paragraph text node at the specified position.",
    inputSchema: InsertTextNodeSchema,
    group: "client",
  },
  insertListNode: {
    description: "Insert a list with initial text (bullet, number, or check).",
    inputSchema: InsertListNodeSchema,
    group: "client",
  },
  insertListItemNode: {
    description:
      "Insert a list item relative to an existing list item or list.",
    inputSchema: InsertListItemNodeSchema,
    group: "client",
  },
  insertTable: {
    description: "Insert a table with specified rows and columns.",
    inputSchema: InsertTableSchema,
    group: "client",
  },
  insertCodeBlock: {
    description: "Insert a code block with optional language and initial text.",
    inputSchema: InsertCodeBlockSchema,
    group: "client",
  },
  insertCodeHighlightNode: {
    description: "Insert inline code highlighting node with provided text.",
    inputSchema: InsertCodeHighlightNodeSchema,
    group: "client",
  },
  applyTextStyle: {
    description:
      "Apply text styles (font, weight, color) to a selection or node.",
    inputSchema: ApplyTextStyleSchema,
    group: "client",
  },
  insertHashtag: {
    description: "Insert a hashtag inline node with provided text.",
    inputSchema: InsertHashtagSchema,
    group: "client",
  },

  // Links & equations
  insertLinkNode: {
    description: "Insert a hyperlink node with URL and optional attributes.",
    inputSchema: InsertLinkNodeSchema,
    group: "client",
  },
  insertEquationNode: {
    description: "Insert a math equation node (inline or block).",
    inputSchema: InsertEquationNodeSchema,
    group: "client",
  },

  // Layout & collapsible
  insertLayout: {
    description: "Insert a layout container with CSS-style template columns.",
    inputSchema: InsertLayoutSchema,
    group: "client",
  },
  insertCollapsibleSection: {
    description:
      "Insert a collapsible container with title and optional initial content.",
    inputSchema: InsertCollapsibleSectionSchema,
    group: "client",
  },
  insertPageBreakNode: {
    description: "Insert a page-break marker node.",
    inputSchema: InsertPageBreakNodeSchema,
    group: "client",
  },

  // Media & embeds
  insertExcalidrawDiagram: {
    description: "Insert an Excalidraw/diagram node using Mermaid and config.",
    inputSchema: InsertExcalidrawDiagramSchema,
    group: "client",
  },
  insertMermaidDiagram: {
    description: "Insert a Mermaid diagram node with optional width/height.",
    inputSchema: InsertMermaidDiagramSchema,
    group: "client",
  },
  insertTweetNode: {
    description: "Insert an embedded Tweet by numeric Tweet ID.",
    inputSchema: InsertTweetNodeSchema,
    group: "client",
  },
  insertYouTubeNode: {
    description: "Insert an embedded YouTube video by ID.",
    inputSchema: InsertYouTubeNodeSchema,
    group: "client",
  },
  insertFigmaNode: {
    description: "Insert an embedded Figma document by ID.",
    inputSchema: InsertFigmaNodeSchema,
    group: "client",
  },

  // Slides
  insertSlideDeckNode: {
    description: "Insert a new slide deck container node.",
    inputSchema: InsertSlideDeckNodeSchema,
    group: "client",
  },
  addSlidePage: {
    description: "Add a slide page to a slide deck.",
    inputSchema: AddSlidePageSchema,
    group: "client",
  },
  removeSlidePage: {
    description: "Remove a slide page from a slide deck by ID.",
    inputSchema: RemoveSlidePageSchema,
    group: "client",
  },
  reorderSlidePage: {
    description: "Reorder a slide page to a new index.",
    inputSchema: ReorderSlidePageSchema,
    group: "client",
  },
  setSlidePageBackground: {
    description: "Set the background color for a slide page.",
    inputSchema: SetSlidePageBackgroundSchema,
    group: "client",
  },
  addBoxToSlidePage: {
    description: "Add a box element to a slide page.",
    inputSchema: AddBoxToSlidePageSchema,
    group: "client",
  },
  addImageToSlidePage: {
    description: "Add an image element to a slide page.",
    inputSchema: AddImageToSlidePageSchema,
    group: "client",
  },
  addChartToSlidePage: {
    description: "Add a chart to a slide page with data and config.",
    inputSchema: AddChartToSlidePageSchema,
    group: "client",
  },

  // Comments
  findAndSelectTextForComment: {
    description: "Find and select text for creating a comment thread.",
    inputSchema: FindAndSelectTextForCommentSchema,
    group: "client",
  },
  addCommentThread: {
    description: "Create a new comment thread.",
    inputSchema: AddCommentThreadSchema,
    group: "client",
  },
  addReplyToThread: {
    description: "Add a reply to an existing comment thread.",
    inputSchema: AddReplyToThreadSchema,
    group: "client",
  },
  removeCommentFromThread: {
    description: "Remove a specific comment from a thread.",
    inputSchema: RemoveCommentFromThreadSchema,
    group: "client",
  },
  removeCommentThread: {
    description: "Remove an entire comment thread.",
    inputSchema: RemoveCommentThreadSchema,
    group: "client",
  },

  // Images & content extraction
  searchAndInsertImage: {
    description: "Search for an image and insert it into the document.",
    inputSchema: SearchAndInsertImageSchema,
    group: "client",
  },
  generateAndInsertImage: {
    description: "Generate an image from a prompt and insert it.",
    inputSchema: GenerateAndInsertImageSchema,
    group: "client",
  },
  extractWebpageContent: {
    description: "Extract main article content from a web page URL.",
    inputSchema: ExtractWebpageContentSchema,
    group: "client",
  },

  // Updates & saves
  updateElementProperties: {
    description: "Update properties of a slide element (box/image/chart).",
    inputSchema: UpdateElementPropertiesSchema,
    group: "client",
  },
  saveStoryboardOutput: {
    description: "Save storyboard slides with key messages and notes.",
    inputSchema: SaveStoryboardOutputSchema,
    group: "client",
  },
  saveSlideContentAndMetadata: {
    description: "Save slide page body content and refined speaker notes.",
    inputSchema: SaveSlideContentAndMetadataSchema,
    group: "client",
  },

  // Code execution (server-side)
  executeCode: {
    description:
      "Run short Node.js snippets in an isolated sandbox and return stdout/stderr.",
    inputSchema: ExecuteCodeSchema,
    group: "server",
  },
  // Code execution (client-side)
  executeCodeClient: {
    description:
      "Run small browser-sandboxed code and return a document update; the host applies to Lexical.",
    inputSchema: ExecuteCodeClientSchema,
    group: "client",
  },
};

export function getAvailableToolNames(): string[] {
  return Object.keys(TOOL_SPECS);
}

export function getToolGroup(toolName: string): "client" | "server" | null {
  const spec = TOOL_SPECS[toolName];
  return spec?.group ?? null;
}

export function getAiSdkToolMap(
  allowedNames: string[],
): Record<
  string,
  Tool<unknown, { success: boolean; content: Record<string, never> }>
> {
  const names = new Set(allowedNames);
  const entries = Object.entries(TOOL_SPECS).filter(([name]) =>
    names.has(name),
  );
  const mapped: Record<
    string,
    Tool<unknown, { success: boolean; content: Record<string, never> }>
  > = {};
  for (const [name, spec] of entries) {
    mapped[name] = tool<
      unknown,
      { success: boolean; content: Record<string, never> }
    >({
      description: spec.description,
      inputSchema: spec.inputSchema,
      // This execute is never run server-side in the agent workflow; client executes instead
      // Returning a structural placeholder keeps types happy if invoked elsewhere
      execute: async (_args: unknown) => ({ success: true, content: {} }),
    });
  }
  return mapped;
}
