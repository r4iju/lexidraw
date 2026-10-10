import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  NarrationPart,
  NarrationRequest,
  NarrationGenerate,
  NARRATION_UNAVAILABLE,
} from "~/lib/narration/contracts";
import type { ProNarration } from "~/server/pro/narration";
import { ProError, type ProLedger } from "~/server/pro/ledger";
import { createTRPCRouter, protectedProcedure } from "../trpc";
export function createNarrationRouter(deps: {
  ledger: () => ProLedger;
  executor?: ProNarration;
  source: (account: string) => Promise<string>;
  read: (account: string, documentId: string) => Promise<string>;
  dispatch: (account: string, id: string) => Promise<unknown>;
}) {
  const procedure = protectedProcedure.use(async ({ next }) => {
    const result = await next();
    if (!result.ok && result.error.cause instanceof ProError)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: result.error.cause.message,
      });
    return result;
  });
  const executor = () => {
    if (!deps.executor) throw new ProError(NARRATION_UNAVAILABLE);
    return deps.executor;
  };
  const selected = async (account: string) => {
    if ((await deps.source(account)) !== "pro")
      throw new ProError("Select Pro in AI Power");
  };
  return createTRPCRouter({
    capability: procedure.query(() => ({
      available: !!deps.executor,
      fixture: !!deps.executor,
      reason: deps.executor
        ? "Injected narration fixture, no actual provider verification."
        : NARRATION_UNAVAILABLE,
    })),
    quote: procedure.input(NarrationRequest).query(async ({ ctx, input }) => {
      const e = executor();
      await selected(ctx.session.user.id);
      const q = await e.quote(
        ctx.session.user.id,
        await deps.read(ctx.session.user.id, input.documentId),
      );
      const { plan: _plan, hash: _hash, ...publicQuote } = q;
      return publicQuote;
    }),
    generate: procedure
      .input(NarrationGenerate)
      .mutation(async ({ ctx, input }) => {
        const e = executor();
        await selected(ctx.session.user.id);
        const account = ctx.session.user.id;
        const result = await e.prepare(
          account,
          input.documentId,
          await deps.read(account, input.documentId),
          input.idempotencyKey,
          input.acceptedMaximum,
          input.acceptedRevision,
          input.acceptedPeriod,
        );
        if (result.id && ["reserved", "running"].includes(result.state)) {
          await deps.dispatch(account, result.id);
          return e.recover(account, result.id);
        }
        return result;
      }),
    latest: procedure.input(NarrationRequest).query(async ({ ctx, input }) => {
      await deps.read(ctx.session.user.id, input.documentId);
      const row = (
        await deps
          .ledger()
          .query(
            "SELECT o.id FROM pro_operations o JOIN pro_narration_jobs j ON j.operation_id=o.id WHERE o.account_id=? AND j.document_id=? ORDER BY o.created_at DESC,o.rowid DESC LIMIT 1",
            [ctx.session.user.id, input.documentId],
          )
      )[0];
      return row ? { id: String(row.id) } : null;
    }),
    operation: procedure
      .input(z.strictObject({ id: z.string() }))
      .query(({ ctx, input }) =>
        executor().recover(ctx.session.user.id, input.id),
      ),
    reconcilePart: procedure
      .input(
        z.strictObject({
          id: z.string(),
          attemptId: z.string(),
          completion: NarrationPart,
          evidence: z.string().min(1).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await deps
          .ledger()
          .reconcileNarrationPart(
            ctx.session.user.id,
            input.id,
            input.attemptId,
            input.completion,
            input.evidence,
          );
        const op = await deps
          .ledger()
          .ownerOperation(ctx.session.user.id, input.id);
        return executor().recover(op.operation.account_id, input.id);
      }),
    cancel: procedure
      .input(z.strictObject({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await deps.ledger().cancel(ctx.session.user.id, input.id);
        return executor().recover(ctx.session.user.id, input.id);
      }),
    saved: procedure.input(NarrationRequest).query(async ({ ctx, input }) => {
      // Playback never requires eligibility, entitlement, available credits, or a provider.
      const e =
        deps.executor ??
        new (await import("~/server/pro/narration")).ProNarration(
          deps.ledger(),
          async () => ({ kind: "unknown" }),
        );
      const q = await e
        .quote(
          ctx.session.user.id,
          await deps.read(ctx.session.user.id, input.documentId),
        )
        .catch(() => {
          throw new ProError("No saved narration for this revision");
        });
      return e.savedPlan(ctx.session.user.id, q.plan);
    }),
  });
}
