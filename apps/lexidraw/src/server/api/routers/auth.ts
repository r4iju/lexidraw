import { TRPCError } from "@trpc/server";
import { SignUpSchema } from "~/app/signup/schema";
import { ProfileSchema } from "~/app/profile/schema";
import env from "@packages/env";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { schema } from "@packages/drizzle";
import { eq } from "@packages/drizzle";

export const authRouter = createTRPCRouter({
  signUp: publicProcedure
    .input(SignUpSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // create user
        const encoder = new TextEncoder();
        const data = encoder.encode(input.password);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashedPassword = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        await ctx.drizzle.insert(schema.users).values({
          email: input.email,
          name: input.name,
          password: hashedPassword,
        });

        return true;
      } catch (error) {
        console.error(error);
        // don't tell why
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Something went wrong",
        });
      }
    }),
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const users = await ctx.drizzle
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        config: schema.users.config,
      })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.session.user.id));
    if (users.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }
    return users[0];
  }),
  updateProfile: protectedProcedure
    .input(ProfileSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .update(schema.users)
        .set({
          name: input.name,
          email: input.email,
          config: {
            ...ctx.session.user.config,
            llm: { googleApiKey: input.googleApiKey ?? "" },
          },
        })
        .where(eq(schema.users.id, ctx.session.user.id));
      return;
    }),
  iceServers: publicProcedure.query(() => {
    return env.ICE_SERVER_CONFIG satisfies RTCIceServer[];
  }),
});
