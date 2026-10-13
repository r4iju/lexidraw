import { ChatInput } from "~/lib/generation/chat";
import { ChatAccept, chatIdentity, type ProChat } from "~/server/pro/chat";
import { Operation } from "~/server/pro/contracts";
import type { AgentDocuments } from "~/server/pro/agent-operation";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import * as schema from "@packages/drizzle/drizzle-schema";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TextInput, Usage, AutocompleteInput } from "~/server/pro/contracts";
import { autocompleteIdentity, inputIdentity } from "~/server/pro/operation";
import { ProError, type ProLedger } from "~/server/pro/ledger";
import type { AppleSandboxBilling } from "~/server/pro/apple-billing";
import type { SandboxBilling } from "~/server/pro/billing";
const Identity = z.strictObject({
  accountId: z.string().min(1).max(100),
  reason: z.string().min(1).max(500),
});
import { ImageCompletion } from "~/lib/images/contracts";
const Outcome = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("completed"),
    text: z.string().min(1).max(16000),
    usage: Usage,
  }),
  z.strictObject({
    kind: z.literal("image_completed"),
    completion: ImageCompletion,
  }),
  z.strictObject({ kind: z.literal("technical_failure") }),
  z.strictObject({ kind: z.literal("cancelled") }),
]);
export function createProRouter(deps: {
  ledger: () => ProLedger;
  textAvailable?: boolean;
  chat?: () => ProChat;
  documents?: () => Pick<AgentDocuments, "read">;
  billing?: () => SandboxBilling;
  appleBilling?: () => AppleSandboxBilling;
  dispatch: (id: string, text: string, account: string) => Promise<unknown>;
}) {
  const procedure = protectedProcedure.use(async ({ next }) => {
    try {
      const result = await next();
      if (!result.ok && result.error.cause instanceof ProError)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: result.error.cause.message,
          cause: result.error.cause,
        });
      return result;
    } catch (error) {
      if (error instanceof ProError)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: error.message,
          cause: error,
        });
      throw error;
    }
  });
  const textCapability = () => ({
    available: deps.textAvailable !== false,
    reason:
      "Pro text is Coming soon until provider access, quality and output bounds are verified. Local and device-key alternatives remain available.",
  });
  const documentScope = z.strictObject({
    documentId: z.string().min(1).max(100),
  });
  const readDocument = async (account: string, document: string) => {
    if (!deps.documents) throw new ProError("Document reads unavailable");
    await deps.documents().read(account, document);
  };
  const scopedChat = async (account: string, document: string, id: string) => {
    await readDocument(account, document);
    const operation = await deps.ledger().operation(account, id);
    const [binding] = await deps
      .ledger()
      .query(
        "SELECT document_id FROM pro_chat_documents WHERE operation_id=?",
        [id],
      );
    if (operation.feature !== "chat" || binding?.document_id !== document)
      throw new ProError("Chat document identity does not match");
    return operation;
  };
  return createTRPCRouter({
    chatUnscoped: procedure.query(async ({ ctx }) => {
      const account = ctx.session.user.id;
      const rows = await deps
        .ledger()
        .query(
          "SELECT o.* FROM pro_operations o WHERE o.account_id=? AND o.feature='chat' AND NOT EXISTS (SELECT 1 FROM pro_chat_documents d WHERE d.operation_id=o.id) AND (o.state IN ('reserved','running','unknown') OR o.id=(SELECT x.id FROM pro_operations x WHERE x.account_id=? AND x.feature='chat' AND x.state IN ('settled','cancelled','refunded') AND NOT EXISTS (SELECT 1 FROM pro_chat_documents y WHERE y.operation_id=x.id) ORDER BY x.created_at DESC,x.rowid DESC LIMIT 1)) ORDER BY o.created_at DESC,o.rowid DESC",
          [account, account],
        );
      return rows.map((row) => Operation.parse(row));
    }),
    chatCurrent: procedure
      .input(documentScope)
      .query(async ({ ctx, input }) => {
        const account = ctx.session.user.id;
        await readDocument(account, input.documentId);
        // Preserve every outstanding identity plus the latest terminal result. Reads never dispatch or expire work.
        const rows = await deps
          .ledger()
          .query(
            "SELECT o.* FROM pro_operations o JOIN pro_chat_documents d ON d.operation_id=o.id WHERE o.account_id=? AND d.document_id=? AND (o.state IN ('reserved','running','unknown') OR o.id=(SELECT x.id FROM pro_operations x JOIN pro_chat_documents y ON y.operation_id=x.id WHERE x.account_id=? AND y.document_id=? AND x.state IN ('settled','cancelled','refunded') ORDER BY x.created_at DESC,x.rowid DESC LIMIT 1)) ORDER BY o.created_at DESC,o.rowid DESC",
            [account, input.documentId, account, input.documentId],
          );
        return rows.map((row) => Operation.parse(row));
      }),
    chatRecovery: procedure
      .input(
        documentScope.extend({
          idempotencyKey: z.string().min(1).max(100),
          input: ChatInput,
        }),
      )
      .query(async ({ ctx, input }) => {
        const operation = await deps
          .ledger()
          .operationByKey(
            ctx.session.user.id,
            input.idempotencyKey,
            chatIdentity(input.input).hash,
            "chat",
          );
        return scopedChat(ctx.session.user.id, input.documentId, operation.id);
      }),
    chatCancel: procedure
      .input(documentScope.extend({ id: z.string().min(1).max(100) }))
      .mutation(async ({ ctx, input }) => {
        await scopedChat(ctx.session.user.id, input.documentId, input.id);
        return deps.ledger().cancel(ctx.session.user.id, input.id);
      }),
    textCapability: procedure.query(textCapability),
    chatCapability: procedure.query(() => ({
      available: !!deps.chat,
      reason:
        "Pro chat is Coming soon until provider streaming, quality and billable bounds are verified. Your saved history is preserved.",
    })),
    chatQuote: procedure.input(ChatInput).mutation(async ({ ctx, input }) => {
      if (!deps.chat)
        throw new ProError(
          "Pro chat is Coming soon. Saved history is preserved.",
        );
      const [user] = await ctx.drizzle
        .select({ config: schema.users.config })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.session.user.id));
      if (user?.config?.aiPower?.mode !== "pro")
        throw new ProError("Select Pro in AI Power");
      return deps.chat().quote(ctx.session.user.id, input);
    }),
    chatAccept: procedure.input(ChatAccept).mutation(async ({ ctx, input }) => {
      if (!deps.chat)
        throw new ProError(
          "Pro chat is Coming soon. Saved history is preserved.",
        );
      const [user] = await ctx.drizzle
        .select({ config: schema.users.config })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.session.user.id));
      if (user?.config?.aiPower?.mode !== "pro")
        throw new ProError("Select Pro in AI Power");
      if (input.documentId)
        await readDocument(ctx.session.user.id, input.documentId);
      return deps
        .chat()
        .accept(
          ctx.session.user.id,
          input.idempotencyKey,
          input.input,
          input.quote,
          input.documentId,
        );
    }),
    appleSandboxGate: procedure.query(async ({ ctx }) => {
      if (
        !deps.appleBilling ||
        !(await deps.ledger().status(ctx.session.user.id)).eligible
      )
        return { available: false as const, environment: "sandbox" as const };
      try {
        return await deps.appleBilling().gate(ctx.session.user.id);
      } catch {
        return { available: false as const, environment: "sandbox" as const };
      }
    }),
    appleSandboxClaim: procedure
      .input(
        z.strictObject({ signedTransaction: z.string().min(1).max(64000) }),
      )
      .mutation(({ ctx, input }) => {
        if (!deps.appleBilling)
          throw new ProError("Apple sandbox billing unavailable");
        return deps
          .appleBilling()
          .claim(ctx.session.user.id, input.signedTransaction);
      }),
    sandboxCheckout: procedure.input(z.strictObject({})).mutation(({ ctx }) => {
      if (!deps.billing) throw new ProError("Sandbox billing unavailable");
      return deps.billing().checkout(ctx.session.user.id);
    }),
    sandboxManagement: procedure
      .input(z.strictObject({}))
      .mutation(({ ctx }) => {
        if (!deps.billing) throw new ProError("Sandbox billing unavailable");
        return deps.billing().portal(ctx.session.user.id);
      }),
    status: procedure.query(({ ctx }) =>
      deps.ledger().status(ctx.session.user.id),
    ),
    text: procedure.input(TextInput).mutation(async ({ ctx, input }) => {
      if (!textCapability().available)
        throw new ProError(textCapability().reason);
      const [user] = await ctx.drizzle
        .select({ config: schema.users.config })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.session.user.id));
      if (user?.config?.aiPower?.mode !== "pro")
        throw new ProError("Select Pro in AI Power");
      const request = inputIdentity(input);
      const ledger = deps.ledger();
      const operation = await ledger.reserve(
        ctx.session.user.id,
        request.idempotencyKey,
        request.hash,
      );
      if (
        !operation.cancel_requested &&
        ["reserved", "running"].includes(operation.state)
      ) {
        try {
          await deps.dispatch(operation.id, request.text, ctx.session.user.id);
        } catch {
          await ledger.failDispatch(ctx.session.user.id, operation.id);
        }
      }
      return ledger.operation(ctx.session.user.id, operation.id);
    }),
    autocomplete: procedure
      .input(AutocompleteInput)
      .mutation(async ({ ctx, input }) => {
        if (!textCapability().available)
          throw new ProError(textCapability().reason);
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
        const request = autocompleteIdentity(input);
        const ledger = deps.ledger();
        const operation = await ledger.reserve(
          ctx.session.user.id,
          request.idempotencyKey,
          request.hash,
          "autocomplete",
        );
        if (
          !operation.cancel_requested &&
          ["reserved", "running"].includes(operation.state)
        ) {
          try {
            await deps.dispatch(
              operation.id,
              request.text,
              ctx.session.user.id,
            );
          } catch {
            await ledger.failDispatch(ctx.session.user.id, operation.id);
          }
        }
        return ledger.operation(ctx.session.user.id, operation.id);
      }),
    textRecovery: procedure.input(TextInput).query(({ ctx, input }) => {
      const request = inputIdentity(input);
      return deps
        .ledger()
        .operationByKey(
          ctx.session.user.id,
          request.idempotencyKey,
          request.hash,
          "text",
        );
    }),
    autocompleteRecovery: procedure
      .input(AutocompleteInput)
      .query(({ ctx, input }) => {
        const request = autocompleteIdentity(input);
        return deps
          .ledger()
          .operationByKey(
            ctx.session.user.id,
            request.idempotencyKey,
            request.hash,
            "autocomplete",
          );
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
