import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { authEffective } from "~/server/auth";
import { drizzle, schema } from "@packages/drizzle";
import { checkPermission } from "./check-permission";
import { assertAdmin } from "./assert-admin";

export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await authEffective();
  return {
    drizzle,
    schema,
    session,
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
      },
    };
  },
});

export const createTRPCRouter = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
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

export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  await assertAdmin(ctx);
  return next();
});

export const protectedProcedureWithPermission = (requiredPermission: string) =>
  t.procedure.use(async ({ ctx, next }) => {
    await checkPermission(ctx, requiredPermission);
    return next();
  });
