import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  NarrationPart,
  NarrationRequest,
  NarrationGenerate,
  NarrationDelivery,
  NarrationSaved,
  NARRATION_UNAVAILABLE,
} from "~/lib/narration/contracts";
import {
  SavedNarrationReader,
  type ProNarration,
} from "~/server/pro/narration";
import { ProError, type ProLedger } from "~/server/pro/ledger";
import { createTRPCRouter, protectedProcedure } from "../trpc";
export function createNarrationRouter(deps: {
  ledger: () => ProLedger;
  /** Resolved per request so importing the router opens no database or provider client. */
  executor?: () => ProNarration | undefined;
  /** Whether the executor dispatches to a preflighted provider rather than an injected fixture. */
  verified?: boolean;
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
    const e = deps.executor?.();
    if (!e) throw new ProError(NARRATION_UNAVAILABLE);
    return e;
  };
  const selected = async (account: string) => {
    if ((await deps.source(account)) !== "pro")
      throw new ProError("Select Pro in AI Power");
  };
  return createTRPCRouter({
    capability: procedure.query(() => {
      const available = !!deps.executor?.();
      return {
        available,
        fixture: available && !deps.verified,
        reason: !available
          ? NARRATION_UNAVAILABLE
          : deps.verified
            ? "Private Gemini narration for owner-granted accounts."
            : "Injected narration fixture, no actual provider verification.",
      };
    }),
    quote: procedure.input(NarrationRequest).query(async ({ ctx, input }) => {
      const e = executor();
      await selected(ctx.session.user.id);
      const q = await e.quote(
        ctx.session.user.id,
        await deps.read(ctx.session.user.id, input.documentId),
      );
      const { plan: _plan, hash: _hash, book: _book, ...publicQuote } = q;
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
          input.delivery,
        );
        if (result.id && ["reserved", "running"].includes(result.state)) {
          const ledger = deps.ledger();
          if (!(await ledger.operation(account, result.id)).cancel_requested) {
            try {
              await deps.dispatch(account, result.id);
            } catch {
              await ledger.failDispatch(account, result.id);
            }
          }
          return e.recover(account, result.id, input.delivery);
        }
        return result;
      }),
    latest: procedure.input(NarrationRequest).query(async ({ ctx, input }) => {
      await deps.read(ctx.session.user.id, input.documentId);
      return new SavedNarrationReader(deps.ledger()).latest(
        ctx.session.user.id,
        input.documentId,
      );
    }),
    operation: procedure
      .input(z.strictObject({ id: z.string(), delivery: NarrationDelivery }))
      .query(async ({ ctx, input }) => {
        const account = ctx.session.user.id;
        const job = await deps.ledger().narrationPlan(account, input.id);
        await deps.read(account, job.documentId);
        return new SavedNarrationReader(deps.ledger()).snapshot(
          account,
          input.id,
          input.delivery,
        );
      }),
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
      .input(z.strictObject({ id: z.string(), delivery: NarrationDelivery }))
      .mutation(async ({ ctx, input }) => {
        await deps.ledger().cancel(ctx.session.user.id, input.id);
        return executor().recover(
          ctx.session.user.id,
          input.id,
          input.delivery,
        );
      }),
    saved: procedure.input(NarrationSaved).query(async ({ ctx, input }) => {
      const account = ctx.session.user.id;
      const text = await deps.read(account, input.documentId);
      return new SavedNarrationReader(deps.ledger()).saved(
        account,
        input.documentId,
        text,
        input.delivery,
      );
    }),
  });
}
