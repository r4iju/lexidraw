import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { authEffective } from "~/server/auth";
import { drizzle, schema } from "@packages/drizzle";
import { checkPermission } from "./check-permission";
import { assertAdmin } from "./assert-admin";
import {
  readBearerApiToken,
  tokenMayRun,
  type RequestAuth,
} from "~/server/auth/api-token-format";
import { resolveApiToken } from "~/server/auth/api-tokens";
import { StaleDocumentError } from "~/server/documents/conflict";
import { AmbiguousHeadingError } from "~/server/documents/markdown";

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const bearer = readBearerApiToken(opts.headers);
  if (bearer) {
    const resolved = await resolveApiToken(bearer);
    if (!resolved) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid, expired, or revoked API token",
      });
    }
    return {
      drizzle,
      schema,
      session: resolved.session,
      auth: resolved.auth as RequestAuth,
      ...opts,
    };
  }
  const session = await authEffective();
  return {
    drizzle,
    schema,
    session,
    auth: { kind: "session" } as RequestAuth,
    ...opts,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
        // ISO so a conflict reads the same over tRPC, REST, and the CLI.
        currentUpdatedAt:
          error.cause instanceof StaleDocumentError
            ? error.cause.currentUpdatedAt.toISOString()
            : null,
        // The headings an ambiguous insert could have meant, so a caller can
        // pick an `nth` without parsing the message.
        candidates:
          error.cause instanceof AmbiguousHeadingError
            ? error.cause.candidates
            : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;

// Every procedure starts here so token scope is enforced even on public ones.
const scopedProcedure = t.procedure.use(({ ctx, type, next }) => {
  if (!tokenMayRun(ctx.auth, type)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This API token has read scope; mutations require write scope",
    });
  }
  return next();
});

export const publicProcedure = scopedProcedure;

export const protectedProcedure = scopedProcedure.use(({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      // infers the `session` as non-nullable
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

/** For token management and admin work: a browser session, never a token. */
export const sessionOnlyProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.auth.kind === "token") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This operation is not available to API tokens",
    });
  }
  return next();
});

export const adminProcedure = sessionOnlyProcedure.use(
  async ({ ctx, next }) => {
    await assertAdmin(ctx);
    return next();
  },
);

export const protectedProcedureWithPermission = (requiredPermission: string) =>
  scopedProcedure.use(async ({ ctx, next }) => {
    await checkPermission(ctx, requiredPermission);
    return next();
  });
