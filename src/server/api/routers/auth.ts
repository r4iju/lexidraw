import { TRPCError } from '@trpc/server';
import bcrypt from 'bcrypt';
import { SignUpSchema } from '~/app/auth/signup/schema';
import { createTRPCRouter, publicProcedure } from '~/server/api/trpc';
import { db } from '~/server/db';

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
});
