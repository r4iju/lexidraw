import { z } from "zod";
import {
  InsertSlideDeckNodeSchema,
  AddSlidePageSchema,
  RemoveSlidePageSchema,
  ReorderSlidePageSchema,
  SetSlidePageBackgroundSchema,
  AddImageToSlidePageSchema,
  AddChartToSlidePageSchema,
  AddBoxToSlidePageSchema,
  InsertMarkdownSchema,
  SaveSlideContentAndMetadataSchema,
  InsertHeadingNodeSchema,
  InsertTextNodeSchema,
  InsertCollapsibleSectionSchema,
  InsertListNodeSchema,
  ExtractWebpageContentSchema,
  SearchAndAddImageToSlidePageSchema,
} from "./tool-schemas.js";

// Minimal shared shapes are imported from base-schemas

type Contract = {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
};

// Core, provider-agnostic contracts
export const TOOL_CONTRACTS: Record<string, Contract> = {
  sendReply: {
    name: "sendReply",
    description: "Sends a text-only reply to the user. Provide replyText.",
    schema: z.object({ replyText: z.string() }),
  },
  requestClarificationOrPlan: {
    name: "requestClarificationOrPlan",
    description:
      "Generates a plan or asks for clarification. Use operation 'plan'|'clarify'.",
    schema: z.object({
      operation: z.enum(["plan", "clarify"]),
      objective: z.string().min(20).max(1500).optional(),
      clarification: z.string().min(20).max(1500).optional(),
    }),
  },
  summarizeAfterToolCallExecution: {
    name: "summarizeAfterToolCallExecution",
    description:
      "Reports the final summary of actions taken. Provide summaryText.",
    schema: z.object({ summaryText: z.string() }),
  },
  insertSlideDeckNode: {
    name: "insertSlideDeckNode",
    description:
      "Insert a new SlideDeck node at a position defined by relation+anchor.",
    schema: InsertSlideDeckNodeSchema,
  },
  addSlidePage: {
    name: "addSlidePage",
    description: "Add a slide page to an existing deck.",
    schema: AddSlidePageSchema,
  },
  removeSlidePage: {
    name: "removeSlidePage",
    description: "Remove a slide page from a deck.",
    schema: RemoveSlidePageSchema,
  },
  reorderSlidePage: {
    name: "reorderSlidePage",
    description: "Reorder a slide page.",
    schema: ReorderSlidePageSchema,
  },
  setSlidePageBackground: {
    name: "setSlidePageBackground",
    description: "Set background color for a slide page.",
    schema: SetSlidePageBackgroundSchema,
  },
  addImageToSlidePage: {
    name: "addImageToSlidePage",
    description: "Add an image element to a slide page.",
    schema: AddImageToSlidePageSchema,
  },
  addChartToSlidePage: {
    name: "addChartToSlidePage",
    description: "Add a chart element to a slide page.",
    schema: AddChartToSlidePageSchema,
  },
  addBoxToSlidePage: {
    name: "addBoxToSlidePage",
    description:
      "Add a box element to a slide page within an existing SlideDeckNode.",
    schema: AddBoxToSlidePageSchema,
  },
  insertMarkdown: {
    name: "insertMarkdown",
    description:
      "Insert content parsed from a Markdown string at relation+anchor.",
    schema: InsertMarkdownSchema,
  },
  saveSlideContentAndMetadata: {
    name: "saveSlideContentAndMetadata",
    description:
      "Save body content blocks and refined speaker notes for a slide page.",
    schema: SaveSlideContentAndMetadataSchema,
  },
  // ——— Added contracts to align server and client tool schemas ——
  insertHeadingNode: {
    name: "insertHeadingNode",
    description:
      "Insert a HeadingNode with tag and text at a position defined by relation+anchor.",
    schema: InsertHeadingNodeSchema,
  },
  insertTextNode: {
    name: "insertTextNode",
    description:
      "Insert a TextNode with provided text at a position defined by relation+anchor.",
    schema: InsertTextNodeSchema,
  },
  insertListNode: {
    name: "insertListNode",
    description:
      "Insert a ListNode (bullet|number|check) with initial item text at relation+anchor.",
    schema: InsertListNodeSchema,
  },
  insertCollapsibleSection: {
    name: "insertCollapsibleSection",
    description:
      "Insert a collapsible section with title and optional initial content.",
    schema: InsertCollapsibleSectionSchema,
  },
  extractWebpageContent: {
    name: "extractWebpageContent",
    description:
      "Fetch a web page server-side and extract a readable text summary.",
    schema: ExtractWebpageContentSchema,
  },
  searchAndAddImageToSlidePage: {
    name: "searchAndAddImageToSlidePage",
    description:
      "Search Unsplash and add the image to a specific slide page in a deck.",
    schema: SearchAndAddImageToSlidePageSchema,
  },
};

export type ToolContractName = keyof typeof TOOL_CONTRACTS;
