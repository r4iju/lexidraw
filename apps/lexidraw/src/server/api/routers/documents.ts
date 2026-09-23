import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { CreateDocument } from "./documents-schema";
import { PublicAccess } from "@packages/types";
import { and, eq, schema } from "@packages/drizzle";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  editorStateToMarkdown,
  InvalidDocumentContentError,
  parseEditorState,
  UnsupportedNodeTypesError,
  withFrontmatter,
} from "~/server/documents/markdown";
import {
  entityPath,
  entityTagNames,
  findReadableEntity,
} from "~/server/entities/readable";
import { start } from "workflow/api";
import { generateDocumentPdfWorkflow } from "~/workflows/document-pdf-export/generate-document-pdf-workflow";

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
          updatedAt: new Date(),
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
