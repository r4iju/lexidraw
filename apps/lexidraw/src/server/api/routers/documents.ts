import { createTRPCRouter, protectedProcedure } from "../trpc";
import { CreateDocument } from "./documents-schema";
import { PublicAccess } from "@packages/types";
import { and, eq, schema } from "@packages/drizzle";
import { z } from "zod";
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
