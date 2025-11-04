import { tool } from "ai";
import { z, type ZodTypeAny } from "zod";
import {
  InsertMarkdownSchema,
  InsertHeadingNodeSchema,
  InsertTextNodeSchema,
  ExtractWebpageContentSchema,
} from "@packages/types";

type ToolSpec = {
  description: string;
  inputSchema: ZodTypeAny;
  group: "client" | "server";
};

const TOOL_SPECS: Record<string, ToolSpec> = {
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
  extractWebpageContent: {
    description: "Extract main article content from a web page URL.",
    inputSchema: ExtractWebpageContentSchema,
    group: "client",
  },
  requestClarificationOrPlan: {
    description:
      "Ask the user a clear follow-up question or propose a short plan before proceeding.",
    inputSchema: z.object({ question: z.string().min(1) }),
    group: "client",
  },
  sendReply: {
    description: "Send a short assistant reply without editing the document.",
    inputSchema: z.object({ message: z.string().min(1) }),
    group: "client",
  },
};

export function getAvailableToolNames(): string[] {
  return Object.keys(TOOL_SPECS);
}

export function getAiSdkToolMap(
  allowedNames: string[],
): Record<string, ReturnType<typeof tool>> {
  const names = new Set(allowedNames);
  const entries = Object.entries(TOOL_SPECS).filter(([name]) =>
    names.has(name),
  );
  const mapped: Record<string, ReturnType<typeof tool>> = {};
  for (const [name, spec] of entries) {
    mapped[name] = tool({
      description: spec.description,
      inputSchema: spec.inputSchema,
      // This execute is never run server-side in the agent workflow; client executes instead
      // Returning a structural placeholder keeps types happy if invoked elsewhere
      execute: async (_args: unknown) => ({ success: true, content: {} }),
    });
  }
  return mapped;
}
