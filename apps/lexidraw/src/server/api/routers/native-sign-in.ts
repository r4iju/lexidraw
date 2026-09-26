import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  exchangeNativeSignInCode,
  NativeSignInExchange,
} from "~/server/auth/native-sign-in";

export const nativeSignInRouter = createTRPCRouter({
  /**
   * The one REST path that takes no token: the caller is a native app that
   * does not have one yet, and the code and verifier are its credentials.
   */
  exchange: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/native-sign-in/token",
        tags: ["auth"],
        summary: "Trade a native sign-in code for a personal access token",
        description:
          "The code arrives at the app's callback after the user approves at /native-sign-in; it is single-use and expires a minute after it is issued. `codeVerifier` is the PKCE verifier behind the S256 challenge sent there, and `redirectUri` the callback it was sent with. Answers a write-scope token named for the device. Every failure is the same 400, and a spent code presented again with its verifier revokes the token it was first traded for.",
        protect: false,
      },
    })
    .input(NativeSignInExchange)
    .output(
      z.object({
        token: z.string(),
        name: z.string(),
        scope: z.enum(["read", "write"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const issued = await exchangeNativeSignInCode(ctx.drizzle, input);
      if (!issued) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid, expired, or already used sign-in code",
        });
      }
      return issued;
    }),
});
