import type { McpServer } from "@modelcontextprotocol/server";
import { EMPTY_CONTENT } from "@packages/lexical-nodes";
import { v4 as uuidV4 } from "uuid";
import { z } from "zod";

import type { appRouter } from "~/server/api/root";
import { apiErrorBody } from "~/server/api/error-body";
import { DrawingElements } from "~/server/drawings/skeleton-schema";

/**
 * The server-side tRPC caller every tool runs through. Tools hold nothing but
 * this: ownership, sharing, and token scope are the router's answers, so a
 * tool that reached the database itself would be a second permission model.
 */
export type RouterCaller = ReturnType<typeof appRouter.createCaller>;

/** What an agent reads before it picks a tool. */
export const MCP_INSTRUCTIONS = `Lexidraw stores documents as a rich-text editor state and drawings as Excalidraw elements; these tools speak markdown and Excalidraw elements and convert at the boundary.

Addressing is by entity id. Find an id with list_entities (a directory listing; omit parentId for the root) or search_entities, never by guessing.

Destructive document writes take a precondition: pass the updatedAt of your last read as ifUnmodifiedSince. There is no "latest" shorthand on the server — read the document, then pass the updatedAt it answered. Every write answers with the updatedAt it produced, which is the precondition for the next one, so a chain of writes needs no read between them.

A failed tool answers with a JSON object carrying a stable "code": branch on that, never on the message. CONFLICT means the precondition no longer matches and data.currentUpdatedAt is the revision to re-read from. BAD_REQUEST from insert_markdown with data.candidates means the heading matched several times; pass one candidate's nth.`;

const entityId = z
  .string()
  .describe("The entity id, as list_entities or search_entities reports it.");

const markdownBody = z
  .string()
  .describe("The markdown to write. Must not be blank.");

const ifUnmodifiedSince = z.iso
  .datetime()
  .describe(
    "The updatedAt of your last read of this document, as an ISO string. A stale value writes nothing and fails with CONFLICT carrying data.currentUpdatedAt.",
  );

const entityTypes = z
  .array(z.enum(["document", "drawing", "directory", "url"]))
  .describe("Restrict the listing to these entity types.");

/**
 * The JSON body a tool answers with. The procedure's output travels as text
 * rather than as `structuredContent`: the router already validated it, and an
 * agent reads the same JSON it would have read over REST.
 */
function ok(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * A procedure's failure as a tool error. The body is the one `/api/v1`
 * answers with, so `code`, `issues`, and `data` mean the same thing here.
 */
function failed(error: unknown) {
  const body = apiErrorBody(error);
  if (body.code === "INTERNAL_SERVER_ERROR") {
    console.error("❌ MCP tool failed:", error);
  }
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
  };
}

/** Runs a procedure and renders whichever way it went. */
async function call(run: () => Promise<unknown>) {
  try {
    return ok(await run());
  } catch (error) {
    return failed(error);
  }
}

/**
 * Registers the tool surface on a freshly constructed server. One tool per
 * procedure, holding no logic of its own; #36 adds the drawing preview as a
 * resource alongside these.
 */
export function registerLexidrawTools(
  server: McpServer,
  caller: RouterCaller,
): void {
  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "The user and token scope this connection resolves to. A read-scope token can call every get_/list_/search_ tool and no other.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => call(() => caller.auth.me({})),
  );

  server.registerTool(
    "list_entities",
    {
      title: "List entities",
      description:
        "The documents, drawings, and directories in one directory. Omit parentId to list the root. This is how you find the id a document tool needs.",
      inputSchema: z.object({
        parentId: z
          .string()
          .optional()
          .describe("The directory to list; omitted lists the root."),
        tagNames: z
          .array(z.string())
          .optional()
          .describe("Only entities carrying every one of these tags."),
        entityTypes: entityTypes.optional(),
        sortBy: z.enum(["updatedAt", "createdAt", "title"]).optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
        includeArchived: z.boolean().optional(),
        onlyFavorites: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    (input) => call(() => caller.entities.list(input)),
  );

  server.registerTool(
    "search_entities",
    {
      title: "Search entities",
      description:
        "Entities of the caller's whose title matches the query, across every directory.",
      inputSchema: z.object({
        query: z.string().describe("Matched against the title."),
      }),
      annotations: { readOnlyHint: true },
    },
    (input) => call(() => caller.entities.search(input)),
  );

  server.registerTool(
    "create_document",
    {
      title: "Create a document",
      description:
        "A new, empty document owned by the caller. Answers with its id and updatedAt; write the body with append_markdown or replace_markdown against that updatedAt.",
      inputSchema: z.object({
        title: z.string().min(1).describe("The document's title."),
        parentId: z
          .string()
          .nullish()
          .describe("The directory to create it in; omitted means the root."),
      }),
    },
    (input) =>
      call(() =>
        caller.entities.create({
          // The id is the caller's to choose, as it is in the browser, so the
          // follow-up write needs no read.
          id: uuidV4(),
          title: input.title,
          entityType: "document",
          elements: JSON.stringify(EMPTY_CONTENT),
          parentId: input.parentId ?? null,
        }),
      ),
  );

  server.registerTool(
    "get_document_markdown",
    {
      title: "Read a document",
      description:
        'A document as markdown. "markdown" carries YAML frontmatter with the id, title, path, updatedAt, and tags; "raw" drops the frontmatter; "json" answers the stored editor state. The updatedAt it reports is the ifUnmodifiedSince of your next write.',
      inputSchema: z.object({
        id: entityId,
        format: z.enum(["markdown", "raw", "json"]).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    (input) =>
      call(() =>
        caller.documents.getMarkdown({
          id: input.id,
          format: input.format ?? "markdown",
        }),
      ),
  );

  server.registerTool(
    "append_markdown",
    {
      title: "Append to a document",
      description:
        "Adds markdown blocks to the end of a document. Never destructive, so ifUnmodifiedSince is optional; pass it anyway when you mean to write against a revision you read.",
      inputSchema: z.object({
        id: entityId,
        markdown: markdownBody,
        ifUnmodifiedSince: ifUnmodifiedSince.optional(),
      }),
    },
    (input) => call(() => caller.documents.appendMarkdown(input)),
  );

  server.registerTool(
    "insert_markdown",
    {
      title: "Insert into a document",
      description:
        "Inserts markdown blocks after a root-level heading or before a root-level block index. Pass exactly one of afterHeading or atBlockIndex, and the ifUnmodifiedSince of your last read. A heading matching several times fails with BAD_REQUEST and data.candidates; pass one candidate's nth.",
      inputSchema: z.object({
        id: entityId,
        markdown: markdownBody,
        afterHeading: z
          .string()
          .optional()
          .describe(
            "Insert after the first root-level heading whose plain text matches (trimmed, whitespace collapsed, case-insensitive). Pass exactly one of afterHeading or atBlockIndex.",
          ),
        nth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "1-based pick among headings matching afterHeading; only valid with afterHeading.",
          ),
        atBlockIndex: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Insert before the root-level block at this 0-based index; the block count appends. Pass exactly one of afterHeading or atBlockIndex.",
          ),
        ifUnmodifiedSince,
      }),
    },
    (input) => call(() => caller.documents.insertMarkdown(input)),
  );

  server.registerTool(
    "replace_markdown",
    {
      title: "Rewrite a document",
      description:
        "Replaces a document's whole body with markdown, against the ifUnmodifiedSince of your last read. Blocks a markdown read showed as a placeholder (an image, a drawing, an embed) survive only if you copy the placeholder line through unchanged; a placeholder you drop is removed from the document.",
      inputSchema: z.object({
        id: entityId,
        markdown: markdownBody,
        ifUnmodifiedSince,
      }),
    },
    (input) => call(() => caller.documents.replaceMarkdown(input)),
  );

  server.registerTool(
    "get_drawing",
    {
      title: "Read a drawing",
      description:
        "A drawing's stored Excalidraw elements and its updatedAt, which is the ifUnmodifiedSince of your next put_drawing.",
      inputSchema: z.object({ id: entityId }),
      annotations: { readOnlyHint: true },
    },
    (input) => call(() => caller.drawings.get(input)),
  );

  server.registerTool(
    "put_drawing",
    {
      title: "Replace a drawing",
      description:
        "Replaces a drawing's elements wholesale, against the ifUnmodifiedSince of your last read. Elements may be shorthand (type, x, y, width, height, text, ...) or whole stored elements; the server fills the rest in. Mermaid is refused.",
      inputSchema: z.object({
        id: entityId,
        elements: DrawingElements,
        ifUnmodifiedSince,
      }),
    },
    (input) => call(() => caller.drawings.put(input)),
  );

  server.registerTool(
    "create_drawing",
    {
      title: "Create a drawing",
      description:
        "A new drawing owned by the caller, optionally with its elements. Answers with its id and updatedAt.",
      inputSchema: z.object({
        title: z.string().min(1).describe("The drawing's title."),
        elements: DrawingElements.optional(),
        parentId: z
          .string()
          .nullish()
          .describe("The directory to create it in; omitted means the root."),
      }),
    },
    (input) =>
      call(() =>
        caller.drawings.create({
          title: input.title,
          elements: input.elements ?? [],
          parentId: input.parentId,
        }),
      ),
  );
}
