import { z } from "zod";
import {
  InsertMarkdownSchema,
  InsertHeadingNodeSchema,
  InsertTextNodeSchema,
  InsertCollapsibleSectionSchema,
  InsertListNodeSchema,
  ExtractWebpageContentSchema,
  ExecuteCodeSchema,
  ExecuteCodeClientSchema,
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
  insertMarkdown: {
    name: "insertMarkdown",
    description:
      "Insert content parsed from a Markdown string at relation+anchor.",
    schema: InsertMarkdownSchema,
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
      "Insert a toggle (collapsible section) whose title is a paragraph or a heading (titleLevel), with optional initial content.",
    schema: InsertCollapsibleSectionSchema,
  },
  extractWebpageContent: {
    name: "extractWebpageContent",
    description:
      "Fetch a web page server-side and extract a readable text summary.",
    schema: ExtractWebpageContentSchema,
  },
  executeCode: {
    name: "executeCode",
    description:
      "Run short Node.js snippets in an isolated sandbox and return stdout/stderr.",
    schema: ExecuteCodeSchema,
  },
  executeCodeClient: {
    name: "executeCodeClient",
    description:
      "Run small browser-sandboxed code that returns a document update to be applied by the host.",
    schema: ExecuteCodeClientSchema,
  },
};

export type ToolContractName = keyof typeof TOOL_CONTRACTS;
