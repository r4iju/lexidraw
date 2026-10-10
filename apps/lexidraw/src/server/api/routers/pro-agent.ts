import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AgentInput, AgentCompletion } from "~/lib/agent/contracts";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { ProError, type ProLedger } from "~/server/pro/ledger";
import type { ProAgentOperation } from "~/server/pro/agent-operation";
export function createAgentRouter(deps: {
  ledger: () => ProLedger;
  executor: () => ProAgentOperation | undefined;
  selected: (account: string) => Promise<boolean>;
  dispatch: (account: string, id: string) => Promise<unknown>;
}) {
  const procedure = protectedProcedure.use(async ({ next }) => {
    const result = await next();
    if (!result.ok && result.error.cause instanceof ProError)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: result.error.cause.message,
      });
    return result;
  });
  const executor = () => {
    const value = deps.executor();
    if (!value)
      throw new ProError(
        "Pro document actions are unavailable pending verified provider access and paid bounds",
      );
    return value;
  };
  const identity = z.strictObject({ id: z.string().min(1).max(100) });
  return createTRPCRouter({
    capability: procedure.query(() => ({
      available: !!deps.executor(),
      reason:
        "Pro document actions await verified provider access, search access and complete paid bounds. Images and sandbox delegation are unavailable.",
      publicState: "coming_soon" as const,
      liveCheckout: false as const,
    })),
    quote: procedure
      .input(
        z.strictObject({
          documentId: z.string().min(1).max(100),
          prompt: z.string().min(1).max(1500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const account = ctx.session.user.id;
        if (!(await deps.selected(account)))
          throw new ProError("Select Pro in AI Power");
        const status = await deps.ledger().status(account);
        if (!status.entitled)
          throw new ProError("Private entitlement required");
        const action = executor();
        const doc = await action.documents.read(account, input.documentId);
        return { maximum: action.book.quote, revision: doc.revision };
      }),
    start: procedure.input(AgentInput).mutation(async ({ ctx, input }) => {
      const account = ctx.session.user.id;
      if (!(await deps.selected(account)))
        throw new ProError("Select Pro in AI Power");
      const action = executor();
      const op = await action.reserve(account, input);
      if (["reserved", "running"].includes(op.state))
        await deps.dispatch(account, op.id);
      return action.view(account, op.id);
    }),
    operation: procedure
      .input(identity)
      .query(({ ctx, input }) =>
        executor().view(ctx.session.user.id, input.id),
      ),
    current: procedure
      .input(z.strictObject({ documentId: z.string().min(1).max(100) }))
      .query(async ({ ctx, input }) => {
        const account = ctx.session.user.id;
        const action = executor();
        await action.documents.read(account, input.documentId);
        const [row] = await deps
          .ledger()
          .query(
            "SELECT o.id FROM pro_operations o JOIN pro_agent_jobs j ON j.operation_id=o.id WHERE o.account_id=? AND j.document_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT 1",
            [account, input.documentId],
          );
        return row ? action.view(account, String(row.id)) : null;
      }),
    reconcileStep: procedure
      .input(
        z.strictObject({
          id: z.string(),
          attemptId: z.string(),
          completion: AgentCompletion,
          evidence: z.string().min(1).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await deps
          .ledger()
          .reconcileAgentStep(
            ctx.session.user.id,
            input.id,
            input.attemptId,
            input.completion,
            input.evidence,
          );
        return deps.ledger().ownerOperation(ctx.session.user.id, input.id);
      }),
    cancel: procedure.input(identity).mutation(async ({ ctx, input }) => {
      await executor().view(ctx.session.user.id, input.id);
      await deps.ledger().cancel(ctx.session.user.id, input.id);
      return executor().view(ctx.session.user.id, input.id);
    }),
  });
}
