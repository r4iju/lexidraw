import { createTRPCRouter, protectedProcedure } from "../trpc";
import { CreateDocument } from "./documents-schema";
import { PublicAccess } from "@packages/types";
import { and, eq, schema } from "@packages/drizzle";
import { z } from "zod";

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
});
