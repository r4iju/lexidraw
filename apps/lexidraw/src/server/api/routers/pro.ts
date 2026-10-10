import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import * as schema from "@packages/drizzle/drizzle-schema";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TextInput, Usage, AutocompleteInput } from "~/server/pro/contracts";
import { inputIdentity } from "~/server/pro/operation";
import { ProError, type ProLedger } from "~/server/pro/ledger";
const Identity = z.strictObject({
  accountId: z.string().min(1).max(100),
  reason: z.string().min(1).max(500),
});
const Outcome = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("completed"),
    text: z.string().min(1).max(16000),
    usage: Usage,
  }),
  z.strictObject({ kind: z.literal("technical_failure") }),
  z.strictObject({ kind: z.literal("cancelled") }),
]);
export function createProRouter(deps: {
  ledger: () => ProLedger;
  dispatch: (id: string, text: string, account: string) => Promise<unknown>;
}) {
  const procedure = protectedProcedure.use(async ({ next }) => {
    try {
      const result = await next();
      if (!result.ok && result.error.cause instanceof ProError)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: result.error.cause.message,
        });
      return result;
    } catch (error) {
      if (error instanceof ProError)
        throw new TRPCError({ code: "FORBIDDEN", message: error.message });
      throw error;
    }
  });
  return createTRPCRouter({
    status: procedure.query(({ ctx }) =>
      deps.ledger().status(ctx.session.user.id),
    ),
    text: procedure.input(TextInput).mutation(async ({ ctx, input }) => {
      const request = inputIdentity(input);
      const ledger = deps.ledger();
      const operation = await ledger.reserve(
        ctx.session.user.id,
        request.idempotencyKey,
        request.hash,
      );
      if (operation.state === "reserved" || operation.state === "running")
        await deps.dispatch(operation.id, request.text, ctx.session.user.id);
      return ledger.operation(ctx.session.user.id, operation.id);
    }),
    autocomplete: procedure
      .input(AutocompleteInput)
      .mutation(async ({ ctx, input }) => {
        if (
          /\b(?:sk-(?:or-v1-|ant-)?[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})/.test(
            JSON.stringify(input),
          )
        )
          throw new ProError("Credential material is not accepted");
        const [user] = await ctx.drizzle
          .select({ config: schema.users.config })
          .from(schema.users)
          .where(eq(schema.users.id, ctx.session.user.id));
        if (user?.config?.aiPower?.mode !== "pro")
          throw new ProError("Select Pro in AI Power");
        if (user?.config?.autocomplete?.enabled !== true)
          throw new ProError("Opt in to writing suggestions first");
        const text = JSON.stringify({
          title: input.title,
          before: input.before,
          after: input.after,
        });
        const request = inputIdentity({
          idempotencyKey: input.idempotencyKey,
          text,
        });
        const ledger = deps.ledger();
        const operation = await ledger.reserve(
          ctx.session.user.id,
          request.idempotencyKey,
          request.hash,
          "autocomplete",
        );
        if (operation.state === "reserved" || operation.state === "running") {
          try {
            await deps.dispatch(
              operation.id,
              request.text,
              ctx.session.user.id,
            );
          } catch {
            await ledger.cancel(ctx.session.user.id, operation.id);
            throw new ProError("Suggestion could not start");
          }
        }
        return ledger.operation(ctx.session.user.id, operation.id);
      }),
    operation: procedure
      .input(z.strictObject({ id: z.string() }))
      .query(({ ctx, input }) =>
        deps.ledger().operation(ctx.session.user.id, input.id),
      ),
    cancel: procedure
      .input(z.strictObject({ id: z.string() }))
      .mutation(({ ctx, input }) =>
        deps.ledger().cancel(ctx.session.user.id, input.id),
      ),
    ownerOperation: procedure
      .input(z.strictObject({ id: z.string() }))
      .query(({ ctx, input }) =>
        deps.ledger().ownerOperation(ctx.session.user.id, input.id),
      ),
    ownerAudit: procedure.query(({ ctx }) =>
      deps.ledger().audit(ctx.session.user.id),
    ),
    grantEligibility: procedure
      .input(Identity)
      .mutation(({ ctx, input }) =>
        deps
          .ledger()
          .grantEligibility(ctx.session.user.id, input.accountId, input.reason),
      ),
    revoke: procedure
      .input(Identity)
      .mutation(({ ctx, input }) =>
        deps
          .ledger()
          .revoke(ctx.session.user.id, input.accountId, input.reason),
      ),
    grantTrial: procedure
      .input(
        Identity.extend({
          eventId: z.string().min(1).max(100),
          startsAt: z.number().int(),
          endsAt: z.number().int(),
          subcredits: z.number().int().positive().max(1_000_000_000),
        }),
      )
      .mutation(({ ctx, input }) =>
        deps
          .ledger()
          .grantPeriod(ctx.session.user.id, { ...input, environment: "test" }),
      ),
    reconcileAttemptCost: procedure
      .input(
        z.strictObject({
          attemptId: z.string(),
          costNanoUsd: z
            .number()
            .int()
            .nonnegative()
            .max(Number.MAX_SAFE_INTEGER),
          evidence: z.string().min(1).max(500),
        }),
      )
      .mutation(({ ctx, input }) =>
        deps
          .ledger()
          .reconcileAttemptCost(
            ctx.session.user.id,
            input.attemptId,
            input.costNanoUsd,
            input.evidence,
          ),
      ),
    reconcile: procedure
      .input(
        z.strictObject({
          id: z.string(),
          outcome: Outcome,
          evidence: z.string().min(1).max(500),
        }),
      )
      .mutation(({ ctx, input }) =>
        deps
          .ledger()
          .reconcile(
            ctx.session.user.id,
            input.id,
            input.outcome,
            input.evidence,
          ),
      ),
  });
}
