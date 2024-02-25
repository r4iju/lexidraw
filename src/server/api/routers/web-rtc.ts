import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";

export const webRtcRouter = createTRPCRouter({
  createOffer: publicProcedure
    .input(z.object({ drawingId: z.string(), offer: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.db.webRTCOffer.create({
        data: {
          drawingId: input.drawingId,
          offer: input.offer,
          createdBy: input.userId,
        }
      })
    }),
  updateOffer: publicProcedure
    .input(z.object({ offerId: z.string(), drawingId: z.string(), offer: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.db.webRTCOffer.update({
        where: { id: input.offerId },
        data: {
          offer: input.offer,
        }
      })
    }),
  upsertOffer: publicProcedure
    .input(z.object({ offerId: z.string(), drawingId: z.string(), offer: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.db.webRTCOffer.upsert({
        where: { id: input.offerId },
        create: {
          id: input.offerId,
          drawingId: input.drawingId,
          offer: input.offer,
          createdBy: input.userId,
        },
        update: {
          offer: input.offer,
        }
      })
    }),
  getOffers: publicProcedure
    .input(z.object({ drawingId: z.string(), userId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      return await ctx.db.webRTCOffer.findMany({
        where: {
          drawingId: input.drawingId,
          updatedAt: { gt: new Date(Date.now() - 1000 * 5) },
          NOT: { createdBy: input.userId }
        }
      })
    }),
  deleteOffer: publicProcedure
    .input(z.object({ offerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.webRTCOffer.delete({
        where: { id: input.offerId }
      })
    }),
  createAnswer: publicProcedure
    .input(z.object({ drawingId: z.string(), answer: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.db.webRTCAnswer.create({
        data: {
          drawingId: input.drawingId,
          answer: input.answer,
          createdBy: input.userId,
        }
      })
    }),
  updateAnswer: publicProcedure
    .input(z.object({ answerId: z.string(), drawingId: z.string(), answer: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.db.webRTCAnswer.update({
        where: { id: input.answerId },
        data: {
          answer: input.answer,
        }
      })
    }),
  upsertAnswer: publicProcedure
    .input(z.object({ answerId: z.string(), drawingId: z.string(), answer: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return await ctx.db.webRTCAnswer.upsert({
        where: { id: input.answerId },
        create: {
          id: input.answerId,
          drawingId: input.drawingId,
          answer: input.answer,
          createdBy: input.userId,
        },
        update: {
          answer: input.answer,
        }
      })
    }),
  getAnswers: publicProcedure
    .input(z.object({ drawingId: z.string(), userId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      return await ctx.db.webRTCAnswer.findMany({
        where: {
          drawingId: input.drawingId,
          // last 5 seconds
          updatedAt: { gt: new Date(Date.now() - 1000 * 5) },
          NOT: { createdBy: input.userId }
        }
      })
    }),
  deleteAnswer: publicProcedure
    .input(z.object({ answerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.webRTCAnswer.delete({
        where: { id: input.answerId }
      })
    }),
})
