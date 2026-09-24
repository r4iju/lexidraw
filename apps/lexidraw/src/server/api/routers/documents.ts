import { queueThumbnail } from "~/server/entities/queue-thumbnail";
import {
  revalidateEntities,
  revalidateEntitiesAndParents,
} from "../entity-cache";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { AfterHeading, CreateDocument, MarkdownBody } from "./documents-schema";
import { PublicAccess } from "@packages/types";
import { and, eq, schema } from "@packages/drizzle";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  appendMarkdownToDocument,
  DocumentGoneError,
  insertMarkdownIntoDocument,
  languageOf,
  replaceMarkdownInDocument,
} from "~/server/documents/write";
import {
  drizzleDocumentStore,
  nextUpdatedAt,
} from "~/server/documents/document-store";
import { StaleDocumentError } from "~/server/documents/conflict";
import {
  DuplicatePlaceholderError,
  PlaceholderPlacementError,
  UnknownPlaceholderError,
} from "~/server/documents/replace";
import {
  AmbiguousHeadingError,
  BlockIndexOutOfRangeError,
  editorStateToMarkdown,
  markdownLosses,
  HeadingNotFoundError,
  InvalidDocumentContentError,
  parseEditorState,
  UnsupportedNodeTypesError,
  documentMarkdown,
} from "~/server/documents/markdown";
import { documentHeaderOf } from "@packages/lexical-nodes";
import {
  entityPath,
  entityTagNames,
  findOwnedEntity,
  findReadableEntity,
  findWritableEntity,
} from "~/server/entities/readable";
import { isoDate } from "../rest-schemas";
import {
  DOCUMENT_RENDER_FORMATS,
  MAX_DOCUMENT_WIDTH,
  ORIENTATIONS,
  PAPER_SIZES,
  RendererUnavailableError,
  RenderFailedError,
  renderDocument,
} from "~/server/documents/render";
import {
  MAX_RENDER_BYTES,
  RenderTooLargeError,
} from "~/server/drawings/render";

/**
 * How every markdown write reports the failures it shares with the others.
 * Anything else is rethrown untouched.
 */
function throwAsDocumentWriteError(error: unknown): never {
  if (
    error instanceof InvalidDocumentContentError ||
    error instanceof UnsupportedNodeTypesError
  ) {
    throw new TRPCError({
      code: "UNPROCESSABLE_CONTENT",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof DocumentGoneError) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof StaleDocumentError) {
    throw new TRPCError({
      code: "CONFLICT",
      message: error.message,
      cause: error,
    });
  }
  if (
    error instanceof HeadingNotFoundError ||
    error instanceof AmbiguousHeadingError ||
    error instanceof BlockIndexOutOfRangeError ||
    error instanceof UnknownPlaceholderError ||
    error instanceof DuplicatePlaceholderError ||
    error instanceof PlaceholderPlacementError
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  throw error;
}

const ONE_PLACEMENT = "pass exactly one of afterHeading or atBlockIndex";

/**
 * What every markdown write answers with, beyond what it changed. `updatedAt`
 * is the revision the write produced, so it is the precondition for the next.
 */
const writtenRevision = {
  id: z.string(),
  title: z
    .string()
    .describe(
      "The title after the write: front matter sets it, and so does a leading # heading on an untitled document.",
    ),
  updatedAt: isoDate,
  notes: z
    .array(z.string())
    .describe(
      "How the markdown was read, where the writer may have meant something else: what front matter set, a leading heading that became the title, callout aliases rewritten, image attributes not kept, footnote markers without a note, tables that will scroll on phones. Empty when nothing needs saying.",
    ),
};

/**
 * The stored Lexical state, passed through as it is: `parseEditorState`
 * guarantees the root and its children and nothing below them, so describing
 * the node types here would be a second, weaker copy of the editor's schema.
 */
const editorState = z.looseObject({
  root: z.looseObject({ children: z.array(z.unknown()) }),
});

const markdownMeta = {
  id: z.string(),
  title: z.string(),
  /** The folders above it the caller can open, then its title, joined with "/". */
  path: z.string(),
  updatedAt: isoDate,
  tags: z.array(z.string()),
};

/** What a markdown read leaves out of the document it describes. */
const losses = z
  .array(z.string())
  .describe(
    "What this markdown leaves out of the stored document, and what a replace from it keeps or drops. Empty when the markdown carries everything.",
  );

/**
 * `format` decides what `content` is, so the two travel as one union rather
 * than as an object whose `content` is a string or an object either way.
 */
const markdownRead = z.discriminatedUnion("format", [
  z.object({
    ...markdownMeta,
    format: z.literal("markdown"),
    content: z.string(),
    losses,
  }),
  z.object({
    ...markdownMeta,
    format: z.literal("raw"),
    content: z.string(),
    losses,
  }),
  z.object({
    ...markdownMeta,
    format: z.literal("json"),
    content: editorState,
  }),
]);

/**
 * A write adds two statuses a read cannot reach: the 409 its precondition
 * guards, and the 403 a read-scope token earns for attempting a mutation.
 */
const READ_ERRORS = [400, 401, 404, 422, 500];
const WRITE_ERRORS = [400, 401, 403, 404, 409, 422, 500];
const RENDER_ERRORS = [400, 401, 404, 413, 500, 502, 503];

export const documentRouter = createTRPCRouter({
  create: protectedProcedure
    .input(CreateDocument)
    .mutation(async ({ input, ctx }) => {
      const created = await ctx.drizzle
        .insert(schema.entities)
        .values({
          id: input.id,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: undefined,
          title: input.title,
          userId: ctx.session?.user.id,
          entityType: "document",
          publicAccess: PublicAccess.PRIVATE,
          elements: input.elements,
        })
        .onConflictDoNothing()
        .returning();
      for (const row of created) await queueThumbnail(ctx.drizzle, row);
      await revalidateEntitiesAndParents(
        ctx.drizzle,
        ...created.map((row) => row.id),
      );
      return created;
    }),
  /**
   * The document as markdown for agents and the CLI. Same read rule as
   * entities.load. Fails naming the node types that have no markdown form yet.
   */
  getMarkdown: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/documents/{id}/markdown",
        tags: ["documents"],
        summary: "Read a document as markdown",
        protect: true,
        errorResponses: READ_ERRORS,
      },
    })
    .input(
      z.object({
        id: z.string(),
        format: z.enum(["markdown", "raw", "json"]).default("markdown"),
      }),
    )
    .output(markdownRead)
    .query(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id ?? "";
      const entity = await findReadableEntity(ctx.drizzle, input.id, userId);
      if (entity?.entityType !== "document") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }
      const [path, tags] = await Promise.all([
        entityPath(ctx.drizzle, entity, userId),
        entityTagNames(ctx.drizzle, entity.id),
      ]);
      const meta = {
        id: entity.id,
        title: entity.title,
        path,
        updatedAt: entity.updatedAt,
        tags,
      };
      const lang = languageOf(entity.appState);
      try {
        const state = parseEditorState(entity.elements);
        if (input.format === "json") {
          // Spread because `SerializedEditorState` is an interface, so it has
          // no implicit index signature and does not satisfy the passthrough
          // object the output schema describes. Same value either way.
          return { ...meta, format: "json" as const, content: { ...state } };
        }
        const header = documentHeaderOf(state);
        return {
          ...meta,
          format: input.format,
          content:
            input.format === "raw"
              ? editorStateToMarkdown(state, { title: entity.title })
              : documentMarkdown(state, { ...meta, lang }),
          losses: [
            ...(input.format === "raw" && Object.keys(header).length > 0
              ? [
                  "The header (subtitle, cover, properties, contents list) is front matter, which raw leaves out; a replace from raw keeps it",
                ]
              : []),
            ...markdownLosses(state),
          ],
        };
      } catch (error) {
        if (
          error instanceof UnsupportedNodeTypesError ||
          error instanceof InvalidDocumentContentError
        ) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: error.message,
            cause: error,
          });
        }
        throw error;
      }
    }),
  /**
   * Appends markdown to the end of a document for agents and the CLI.
   * `ifUnmodifiedSince` is the `updatedAt` of the revision the caller read;
   * when it no longer matches, nothing is written and the error carries the
   * current one as `data.currentUpdatedAt`.
   */
  appendMarkdown: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/documents/{id}/markdown/append",
        tags: ["documents"],
        summary: "Append markdown to the end of a document",
        protect: true,
        errorResponses: WRITE_ERRORS,
      },
    })
    .input(
      z.object({
        id: z.string(),
        markdown: MarkdownBody,
        ifUnmodifiedSince: z.iso.datetime().optional(),
      }),
    )
    .output(z.object({ ...writtenRevision, appendedBlocks: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const entity = await findWritableEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (entity?.entityType !== "document") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }
      try {
        const written = await appendMarkdownToDocument(
          drizzleDocumentStore(ctx.drizzle, ctx.session.user.id, (row) =>
            queueThumbnail(ctx.drizzle, row),
          ),
          {
            ...entity,
            tags: await entityTagNames(ctx.drizzle, entity.id),
          },
          input.markdown,
          input.ifUnmodifiedSince,
        );
        // The parent too: a directory listing shows each child's updatedAt.
        revalidateEntities(input.id, entity.parentId);
        return written;
      } catch (error) {
        throwAsDocumentWriteError(error);
      }
    }),
  /**
   * Inserts markdown directly below a top-level heading, or at a top-level
   * block index, for agents and the CLI. A heading is matched by its plain
   * text, trimmed, whitespace-collapsed, and case-insensitively; several
   * matches fail with the candidates on `data.candidates`, and `nth` (1-based)
   * picks one.
   *
   * `ifUnmodifiedSince` is mandatory here: unlike an append, an insert lands
   * among blocks the caller must have read to be able to point at them.
   */
  insertMarkdown: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/documents/{id}/markdown/insert",
        tags: ["documents"],
        summary: "Insert markdown after a heading or at a block index",
        protect: true,
        errorResponses: WRITE_ERRORS,
      },
    })
    .input(
      z
        .object({
          id: z.string(),
          markdown: MarkdownBody,
          afterHeading: AfterHeading.optional(),
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
          ifUnmodifiedSince: z.iso.datetime(),
        })
        // Transformed rather than refined so the placement the procedure reads
        // carries only the one the caller asked for.
        .transform(({ afterHeading, nth, atBlockIndex, ...rest }, ctx) => {
          if (afterHeading !== undefined && atBlockIndex !== undefined) {
            ctx.addIssue({ code: "custom", message: ONE_PLACEMENT });
            return z.NEVER;
          }
          if (nth !== undefined && afterHeading === undefined) {
            ctx.addIssue({
              code: "custom",
              message: "nth only applies to afterHeading",
            });
            return z.NEVER;
          }
          if (afterHeading !== undefined) {
            return {
              ...rest,
              placement: {
                kind: "afterHeading" as const,
                text: afterHeading,
                nth,
              },
            };
          }
          if (atBlockIndex !== undefined) {
            return {
              ...rest,
              placement: { kind: "atBlockIndex" as const, index: atBlockIndex },
            };
          }
          ctx.addIssue({ code: "custom", message: ONE_PLACEMENT });
          return z.NEVER;
        }),
    )
    .output(
      z.object({
        ...writtenRevision,
        insertedBlocks: z.number(),
        blockIndex: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const entity = await findWritableEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (entity?.entityType !== "document") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }
      try {
        const written = await insertMarkdownIntoDocument(
          drizzleDocumentStore(ctx.drizzle, ctx.session.user.id, (row) =>
            queueThumbnail(ctx.drizzle, row),
          ),
          {
            ...entity,
            tags: await entityTagNames(ctx.drizzle, entity.id),
          },
          input.markdown,
          input.placement,
          input.ifUnmodifiedSince,
        );
        // The parent too: a directory listing shows each child's updatedAt.
        revalidateEntities(input.id, entity.parentId);
        return written;
      } catch (error) {
        throwAsDocumentWriteError(error);
      }
    }),
  list: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle
      .select()
      .from(schema.entities)
      .where(
        and(
          eq(schema.entities.userId, ctx.session?.user.id),
          eq(schema.entities.entityType, "document"),
        ),
      )
      .execute();
  }),
  /**
   * Rewrites a whole document from markdown for agents and the CLI. Blocks
   * with no markdown form travel as placeholder comments: one the caller left
   * in puts the original node back, one the caller deleted deletes it, and
   * the summary after `#N` is never read. A block placeholder has to stand
   * alone on its own line, the way the read wrote it.
   *
   * `ifUnmodifiedSince` is mandatory: a replace decides the fate of every
   * block, so it only makes sense against the revision the caller read.
   */
  replaceMarkdown: protectedProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/documents/{id}/markdown",
        tags: ["documents"],
        summary: "Rewrite a whole document from markdown",
        protect: true,
        errorResponses: WRITE_ERRORS,
      },
    })
    .input(
      z.object({
        id: z.string(),
        markdown: MarkdownBody,
        ifUnmodifiedSince: z.iso.datetime(),
      }),
    )
    .output(
      z.object({
        ...writtenRevision,
        blocks: z.number(),
        restoredPlaceholders: z.number(),
        removedPlaceholders: z.number(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const entity = await findWritableEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (entity?.entityType !== "document") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }
      try {
        const written = await replaceMarkdownInDocument(
          drizzleDocumentStore(ctx.drizzle, ctx.session.user.id, (row) =>
            queueThumbnail(ctx.drizzle, row),
          ),
          {
            ...entity,
            tags: await entityTagNames(ctx.drizzle, entity.id),
          },
          input.markdown,
          input.ifUnmodifiedSince,
        );
        // The parent too: a directory listing shows each child's updatedAt.
        revalidateEntities(input.id, entity.parentId);
        return written;
      } catch (error) {
        throwAsDocumentWriteError(error);
      }
    }),
  save: protectedProcedure
    .input(z.object({ id: z.string(), elements: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const entity = await findWritableEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (entity?.entityType !== "document") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }
      const saved = await ctx.drizzle
        .update(schema.entities)
        .set({
          // Strictly increasing, so a compare-and-set caller can tell this
          // save apart from its own; see nextUpdatedAt.
          updatedAt: nextUpdatedAt(),
          elements: input.elements,
        })
        .where(eq(schema.entities.id, input.id))
        .returning();
      for (const row of saved) await queueThumbnail(ctx.drizzle, row);
      revalidateEntities(input.id, entity.parentId);
      return saved;
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Deleting is the owner's alone; an editor may write the document but
      // not take it away from whoever shared it.
      const entity = await findOwnedEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (entity?.entityType !== "document") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }
      const deleted = await ctx.drizzle
        .update(schema.entities)
        .set({
          deletedAt: new Date(),
        })
        .where(eq(schema.entities.id, input.id));
      await revalidateEntitiesAndParents(
        ctx.drizzle,
        input.id,
        entity.parentId,
      );
      return deleted;
    }),
  /**
   * Renders a document for anyone who can read it, a read-only token
   * included. Signed in only: the render is made on the caller's behalf.
   */
  render: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/documents/{id}/render",
        tags: ["documents"],
        summary: "Render a document as PNG or PDF",
        description: `Returns the file in the JSON body, base64-encoded in \`data\`. PNG defaults to width 1280 and light theme; width and theme select its viewport. PNGs over 16 megapixels are refused. \`paper\` and \`orientation\` set the page; the document prints light whatever theme its reader uses. A file over ${MAX_RENDER_BYTES / 1_000_000} MB encoded is refused with 413, and 503 means this server has no page renderer to print with.`,
        protect: true,
        errorResponses: RENDER_ERRORS,
      },
    })
    .input(
      z.object({
        id: z.string(),
        format: z.enum(DOCUMENT_RENDER_FORMATS).default("png"),
        width: z.number().int().min(320).max(MAX_DOCUMENT_WIDTH).default(1280),
        theme: z.enum(["light", "dark"]).default("light"),
        paper: z.enum(PAPER_SIZES).default("A4"),
        orientation: z.enum(ORIENTATIONS).default("portrait"),
      }),
    )
    .output(
      z.object({
        id: z.string(),
        format: z.enum(DOCUMENT_RENDER_FORMATS),
        contentType: z.string(),
        encoding: z.literal("base64"),
        data: z.string(),
        /** The revision rendered, so a caller can tell one render from a later one. */
        updatedAt: isoDate,
      }),
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const entity = await findReadableEntity(ctx.drizzle, input.id, userId);
      if (entity?.entityType !== "document") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }
      let file: Uint8Array;
      try {
        file = await renderDocument({
          documentId: entity.id,
          userId,
          options:
            input.format === "pdf"
              ? {
                  format: "pdf",
                  paper: input.paper,
                  orientation: input.orientation,
                }
              : { format: "png", width: input.width, theme: input.theme },
        });
      } catch (error) {
        if (error instanceof RenderTooLargeError) {
          throw new TRPCError({
            code: "PAYLOAD_TOO_LARGE",
            message: error.message,
          });
        }
        if (error instanceof RendererUnavailableError) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: error.message,
            cause: error,
          });
        }
        if (error instanceof RenderFailedError) {
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: "The document could not be rendered",
            cause: error,
          });
        }
        throw error;
      }
      const data = Buffer.from(file).toString("base64");
      const bytes = Buffer.byteLength(data);
      if (bytes > MAX_RENDER_BYTES) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `This render encodes to ${Math.round(bytes / 100_000) / 10} MB, over the ${MAX_RENDER_BYTES / 1_000_000} MB a response can carry`,
        });
      }
      return {
        id: entity.id,
        format: input.format,
        contentType: input.format === "pdf" ? "application/pdf" : "image/png",
        encoding: "base64" as const,
        data,
        updatedAt: entity.updatedAt,
      };
    }),
});
