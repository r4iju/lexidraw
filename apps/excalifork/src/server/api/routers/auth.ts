import { TRPCError } from '@trpc/server';
import bcrypt from 'bcrypt';
import { SignUpSchema } from '~/app/auth/signup/schema';
import { ProfileSchema } from '~/app/profile/schema';
import env from '@packages/env';
import { createTRPCRouter, protectedProcedure, publicProcedure } from '~/server/api/trpc';
import { db } from '@packages/db';

export const authRouter = createTRPCRouter({
  signUp: publicProcedure.input(SignUpSchema).mutation(async ({ input }) => {
    try {
      // create user
      const hashedPassword = await bcrypt.hash(input.password, 10);
      await db.user.create({
        data: {
          email: input.email,
          name: input.name,
          password: hashedPassword,
        },
      });
      return true;
    } catch (error) {
      console.error(error);
      // don't tell why
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Something went wrong',
      });
    }
  }),
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { id: true, email: true, name: true },
    });
  }),
  updateProfile: protectedProcedure
    .input(ProfileSchema)
    .mutation(async ({ ctx, input }) => {
      await db.user.update({
        where: { id: ctx.session.user.id },
        data: {
          name: input.name,
          email: input.email,
        },
      });
      return;
    }),
  iceServers: publicProcedure.query(() => {
    return env.ICE_SERVER_CONFIG satisfies RTCIceServer[];
  }),
});
