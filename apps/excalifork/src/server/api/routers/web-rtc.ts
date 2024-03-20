import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { and, eq, lte, ne, schema } from "@packages/drizzle";

export const webRtcRouter = createTRPCRouter({
  createOffer: publicProcedure
    .input(z.object({ drawingId: z.string(), offer: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .insert(schema.webRtcOffer)
        .values({
          createdAt: new Date(),
          updatedAt: new Date(),
          drawingId: input.drawingId,
          offer: input.offer,
          createdBy: input.userId,
        })
        .execute();
    }),
  updateOffer: publicProcedure
    .input(z.object({ offerId: z.number(), drawingId: z.string(), offer: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .update(schema.webRtcOffer)
        .set({
          offer: input.offer,
        })
        .where(eq(schema.webRtcOffer.id, input.offerId))
        .execute();
    }),
  upsertOffer: publicProcedure
    .input(z.object({ offerId: z.number(), drawingId: z.string(), offer: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .insert(schema.webRtcOffer)
        .values({
          createdAt: new Date(),
          updatedAt: new Date(),
          drawingId: input.drawingId,
          offer: input.offer,
          createdBy: input.userId,
        })
        .onConflictDoUpdate({
          target: schema.webRtcOffer.id,
          set: {
            offer: input.offer,
            updatedAt: new Date(),
          },
        })
        .execute();
    }),
  getOffers: publicProcedure
    .input(z.object({ drawingId: z.string(), userId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      return await ctx.drizzle
        .select()
        .from(schema.webRtcOffer)
        .where(and(
          eq(schema.webRtcOffer.drawingId, input.drawingId),
          ne(schema.webRtcOffer.createdBy, input.userId),
          lte(schema.webRtcOffer.updatedAt, new Date(new Date().getTime() - 1000 * 5)),
        ))
    }),
  deleteOffer: publicProcedure
    .input(z.object({ offerId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle
        .delete(schema.webRtcOffer)
        .where(eq(schema.webRtcOffer.id, input.offerId))
        .execute();
    }),
  createAnswer: publicProcedure
    .input(z.object({ drawingId: z.string(), answer: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .insert(schema.webRtcAnswer)
        .values({
          createdAt: new Date(),
          updatedAt: new Date(),
          drawingId: input.drawingId,
          answer: input.answer,
          createdBy: input.userId,
        })
        .execute();
    }),
  updateAnswer: publicProcedure
    .input(z.object({ answerId: z.number(), drawingId: z.string(), answer: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .update(schema.webRtcAnswer)
        .set({
          answer: input.answer,
        })
        .where(eq(schema.webRtcAnswer.id, input.answerId))
        .execute();
    }),
  upsertAnswer: publicProcedure
    .input(z.object({ answerId: z.string(), drawingId: z.string(), answer: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .insert(schema.webRtcAnswer)
        .values({
          createdAt: new Date(),
          updatedAt: new Date(),
          drawingId: input.drawingId,
          answer: input.answer,
          createdBy: input.userId,
        })
        .onConflictDoUpdate({
          target: schema.webRtcAnswer.id,
          set: {
            answer: input.answer,
            updatedAt: new Date(),
          },
        })
        .execute();
    }),
  getAnswers: publicProcedure
    .input(z.object({ drawingId: z.string(), userId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      return await ctx.drizzle
        .select()
        .from(schema.webRtcAnswer)
        .where(and(
          eq(schema.webRtcAnswer.drawingId, input.drawingId),
          ne(schema.webRtcAnswer.createdBy, input.userId),
          lte(schema.webRtcAnswer.updatedAt, new Date(new Date().getTime() - 1000 * 5)),
        ))
    }),
  deleteAnswer: publicProcedure
    .input(z.object({ answerId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle
        .delete(schema.webRtcAnswer)
        .where(eq(schema.webRtcAnswer.id, input.answerId))
        .execute();
    }),
})
