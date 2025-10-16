import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { and, eq, lte, ne, schema } from "@packages/drizzle";

export const webRtcRouter = createTRPCRouter({
  createOffer: publicProcedure
    .input(
      z.object({
        drawingId: z.string(),
        offer: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .insert(schema.webRtcOffers)
        .values({
          createdAt: new Date(),
          updatedAt: new Date(),
          entityId: input.drawingId,
          offer: input.offer,
          createdBy: input.userId,
        })
        .execute();
    }),
  updateOffer: publicProcedure
    .input(
      z.object({
        offerId: z.number(),
        drawingId: z.string(),
        offer: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .update(schema.webRtcOffers)
        .set({
          offer: input.offer,
        })
        .where(eq(schema.webRtcOffers.id, input.offerId))
        .execute();
    }),
  upsertOffer: publicProcedure
    .input(
      z.object({
        offerId: z.number(),
        drawingId: z.string(),
        offer: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .insert(schema.webRtcOffers)
        .values({
          createdAt: new Date(),
          updatedAt: new Date(),
          entityId: input.drawingId,
          offer: input.offer,
          createdBy: input.userId,
        })
        .onConflictDoUpdate({
          target: schema.webRtcOffers.id,
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
        .from(schema.webRtcOffers)
        .where(
          and(
            eq(schema.webRtcOffers.entityId, input.drawingId),
            ne(schema.webRtcOffers.createdBy, input.userId),
            lte(schema.webRtcOffers.updatedAt, new Date(Date.now() - 1000 * 5)),
          ),
        );
    }),
  deleteOffer: publicProcedure
    .input(z.object({ offerId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle
        .delete(schema.webRtcOffers)
        .where(eq(schema.webRtcOffers.id, input.offerId))
        .execute();
    }),
  createAnswer: publicProcedure
    .input(
      z.object({
        drawingId: z.string(),
        answer: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .insert(schema.webRtcAnswers)
        .values({
          createdAt: new Date(),
          updatedAt: new Date(),
          entityId: input.drawingId,
          answer: input.answer,
          createdBy: input.userId,
        })
        .execute();
    }),
  updateAnswer: publicProcedure
    .input(
      z.object({
        answerId: z.number(),
        drawingId: z.string(),
        answer: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .update(schema.webRtcAnswers)
        .set({
          answer: input.answer,
        })
        .where(eq(schema.webRtcAnswers.id, input.answerId))
        .execute();
    }),
  upsertAnswer: publicProcedure
    .input(
      z.object({
        answerId: z.string(),
        drawingId: z.string(),
        answer: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
        .insert(schema.webRtcAnswers)
        .values({
          createdAt: new Date(),
          updatedAt: new Date(),
          entityId: input.drawingId,
          answer: input.answer,
          createdBy: input.userId,
        })
        .onConflictDoUpdate({
          target: schema.webRtcAnswers.id,
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
        .from(schema.webRtcAnswers)
        .where(
          and(
            eq(schema.webRtcAnswers.entityId, input.drawingId),
            ne(schema.webRtcAnswers.createdBy, input.userId),
            lte(
              schema.webRtcAnswers.updatedAt,
              new Date(Date.now() - 1000 * 5),
            ),
          ),
        );
    }),
  deleteAnswer: publicProcedure
    .input(z.object({ answerId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle
        .delete(schema.webRtcAnswers)
        .where(eq(schema.webRtcAnswers.id, input.answerId))
        .execute();
    }),
});
