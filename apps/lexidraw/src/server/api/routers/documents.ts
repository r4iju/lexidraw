import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { CreateDocument } from "./documents-schema";
import { PublicAccess } from "@packages/types";
import { and, eq, schema } from "@packages/drizzle";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  appendMarkdownToDocument,
  DocumentGoneError,
  insertMarkdownIntoDocument,
} from "~/server/documents/write";
import {
  drizzleDocumentStore,
  nextUpdatedAt,
} from "~/server/documents/document-store";
import { StaleDocumentError } from "~/server/documents/conflict";
import {
  AmbiguousHeadingError,
  BlockIndexOutOfRangeError,
  editorStateToMarkdown,
  HeadingNotFoundError,
  InvalidDocumentContentError,
  parseEditorState,
  UnsupportedNodeTypesError,
  withFrontmatter,
} from "~/server/documents/markdown";
import {
  entityPath,
  entityTagNames,
  findReadableEntity,
  findWritableEntity,
} from "~/server/entities/readable";
import { start } from "workflow/api";
import { generateDocumentPdfWorkflow } from "~/workflows/document-pdf-export/generate-document-pdf-workflow";

/**
 * How every markdown write reports the failures it shares with the others.
 * Anything else is rethrown untouched.
 */
function throwAsDocumentWriteError(error: unknown): never {
  if (error instanceof InvalidDocumentContentError) {
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
    error instanceof BlockIndexOutOfRangeError
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

const nonBlank = (field: string) =>
  z
    .string()
    .refine((value) => value.trim() !== "", `${field} must not be blank`);

// Refined rather than trimmed: leading indentation is markdown too.
const MarkdownBody = nonBlank("markdown");

export const documentRouter = createTRPCRouter({
  create: protectedProcedure
    .input(CreateDocument)
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
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
    }),
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      return await ctx.drizzle.query.entities.findFirst({
        where: (doc, { eq, and }) =>
          and(eq(doc.id, input.id), eq(doc.entityType, "document")),
      });
    }),
  /**
   * The document as markdown for agents and the CLI. Same read rule as
   * entities.load. Fails naming the node types that have no markdown form yet.
   */
  getMarkdown: publicProcedure
    .input(
      z.object({
        id: z.string(),
        format: z.enum(["markdown", "raw", "json"]).default("markdown"),
      }),
    )
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
        entityPath(ctx.drizzle, entity),
        entityTagNames(ctx.drizzle, entity.id),
      ]);
      const meta = {
        id: entity.id,
        title: entity.title,
        path,
        updatedAt: entity.updatedAt,
        tags,
      };
      try {
        const state = parseEditorState(entity.elements);
        if (input.format === "json") {
          return { ...meta, format: "json" as const, content: state };
        }
        const markdown = editorStateToMarkdown(state);
        return {
          ...meta,
          format: input.format,
          content:
            input.format === "raw" ? markdown : withFrontmatter(meta, markdown),
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
    .input(
      z.object({
        id: z.string(),
        markdown: MarkdownBody,
        ifUnmodifiedSince: z.iso.datetime().optional(),
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
        return await appendMarkdownToDocument(
          drizzleDocumentStore(ctx.drizzle),
          entity,
          input.markdown,
          input.ifUnmodifiedSince,
        );
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
    .input(
      z
        .object({
          id: z.string(),
          markdown: MarkdownBody,
          afterHeading: nonBlank("afterHeading").optional(),
          nth: z.number().int().positive().optional(),
          atBlockIndex: z.number().int().nonnegative().optional(),
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
        return await insertMarkdownIntoDocument(
          drizzleDocumentStore(ctx.drizzle),
          entity,
          input.markdown,
          input.placement,
          input.ifUnmodifiedSince,
        );
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
  save: protectedProcedure
    .input(z.object({ id: z.string(), elements: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .update(schema.entities)
        .set({
          // Strictly increasing, so a compare-and-set caller can tell this
          // save apart from its own; see nextUpdatedAt.
          updatedAt: nextUpdatedAt(),
          elements: input.elements,
        })
        .where(eq(schema.entities.id, input.id))
        .returning();
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .update(schema.entities)
        .set({
          deletedAt: new Date(),
        })
        .where(eq(schema.entities.id, input.id));
    }),
  exportPdf: protectedProcedure
    .input(
      z.object({
        documentId: z.string(),
        format: z.enum(["A4", "Letter"]).optional(),
        orientation: z.enum(["portrait", "landscape"]).optional(),
        margin: z
          .object({
            top: z.string().optional(),
            right: z.string().optional(),
            bottom: z.string().optional(),
            left: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session?.user.id;
      if (!userId) {
        throw new Error("Unauthorized");
      }

      // Check document access
      const document = await ctx.drizzle.query.entities.findFirst({
        where: (doc, { eq, and }) =>
          and(eq(doc.id, input.documentId), eq(doc.entityType, "document")),
      });

      if (!document) {
        throw new Error("Document not found");
      }

      // Check if user owns the document
      if (document.userId !== userId) {
        throw new Error("Unauthorized");
      }

      // Start workflow (fire-and-forget) and await result
      // For now, we await the workflow; can be made async if needed
      const result = await start(generateDocumentPdfWorkflow, [
        input.documentId,
        userId,
        {
          format: input.format,
          orientation: input.orientation,
          margin: input.margin,
        },
      ]);
      const returnValue = await result.returnValue;

      return { pdfUrl: returnValue.pdfUrl };
    }),
});
