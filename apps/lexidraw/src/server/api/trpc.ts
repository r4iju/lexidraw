import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { OpenApiMeta } from "trpc-to-openapi";
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
import { errorCauseData } from "./error-body";

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

/**
 * Context for the REST transport. `/api/v1` exists for agents, so a personal
 * access token is the only way in: without one the answer is 401 rather than
 * an anonymous read of whatever happens to be public.
 */
export const createRestContext = async (opts: { headers: Headers }) => {
  if (!readBearerApiToken(opts.headers)) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Missing API token; send Authorization: Bearer lxd_...",
    });
  }
  return createTRPCContext(opts);
};

/**
 * Context for a REST operation the document publishes without security. It is
 * nobody, whatever the request carries: no cookie session and no token.
 */
export const createAnonymousRestContext = (opts: {
  headers: Headers;
}): Awaited<ReturnType<typeof createTRPCContext>> => ({
  drizzle,
  schema,
  session: null,
  auth: { kind: "session" },
  ...opts,
});

const t = initTRPC
  .meta<OpenApiMeta>()
  .context<typeof createTRPCContext>()
  .create({
    transformer: superjson,
    // Only `rooms.signals` streams. It ends before the function's
    // `maxDuration` (`app/api/trpc/[trpc]/route.ts`) and the client picks it
    // up again; pings keep idle streams open through proxies meanwhile.
    sse: {
      maxDurationMs: 240_000,
      ping: { enabled: true, intervalMs: 15_000 },
      client: { reconnectAfterInactivityMs: 30_000 },
    },
    errorFormatter({ shape, error }) {
      // A driver error quotes the failing SQL and its bound parameters, in the
      // message and again in the stack. Neither leaves the server for a 500;
      // the route handlers log the original.
      const internal = error.code === "INTERNAL_SERVER_ERROR";
      return {
        ...shape,
        message: internal ? "Internal server error" : shape.message,
        data: {
          ...shape.data,
          stack: internal ? undefined : shape.data.stack,
          zodError:
            error.cause instanceof ZodError ? error.cause.flatten() : null,
          ...errorCauseData(error.cause),
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
