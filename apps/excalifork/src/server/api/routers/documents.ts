import { createTRPCRouter, protectedProcedure } from "../trpc";
import { CreateDocument } from "./documents-schema";
import { PublicAccess } from "@packages/types";
import { and, eq, schema, } from "@packages/drizzle";
import { z } from "zod";

export const documentRouter = createTRPCRouter({
  create: protectedProcedure
    .input(CreateDocument)
    .mutation(async ({ input, ctx }) => {
      console.log(input)
      return await ctx.drizzle
        .insert(schema.entity)
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
        .returning()
    }),
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      return await ctx.drizzle.query.entity
        .findFirst({
          where: (doc, { eq, and }) => and(
            eq(doc.id, input.id),
            eq(doc.entityType, "document"),
          ),
        })
    }),
  list: protectedProcedure
    .query(async ({ ctx }) => {
      return await ctx.drizzle
        .select()
        .from(schema.entity)
        .where(and(
          eq(schema.entity.userId, ctx.session?.user.id),
          eq(schema.entity.entityType, "document"),
        ))
        .execute();
    }),
  save: protectedProcedure
    .input(z.object({ id: z.string(), elements: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .update(schema.entity)
        .set({
          updatedAt: new Date(),
          elements: input.elements,
        })
        .where(eq(schema.entity.id, input.id))
        .returning()
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .update(schema.entity)
        .set({
          deletedAt: new Date(),
        })
        .where(eq(schema.entity.id, input.id))
    }),
})