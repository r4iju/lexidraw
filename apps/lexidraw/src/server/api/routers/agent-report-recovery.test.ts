import { expect, mock, test } from "bun:test";
import { createClient } from "@libsql/client";
import { installServerRuntime } from "~/test/server-runtime";
import { ProLedger } from "~/server/pro/ledger";
import { ProAgentOperation } from "~/server/pro/agent-operation";
import { AGENT_BOOK, AgentCompletion } from "~/lib/agent/contracts";
import { supplierFixture } from "~/test/supplier-fixture";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const db = await installServerRuntime();
const { schema } = await import("@packages/drizzle");
const { createAgentRouter } = await import("./pro-agent");

test("production exact B reader returns null while earlier A saved edits remain independently readable", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    for (const name of [
      "0015_private_pro",
      "0016_pro_billing_events",
      "0029_sandbox_billing",
      "0030_apple_sandbox",
      "0025_pro_narration",
      "0027_pro_agent",
    ])
      await client.executeMultiple(
        (
          await Bun.file(`../../packages/drizzle/drizzle/${name}.sql`).text()
        ).replaceAll("--> statement-breakpoint", ""),
      );
    const ledger = new ProLedger(client, {
      ownerAccountIds: ["owner"],
      supplierBooks: supplierFixture,
      agentBook: () => AGENT_BOOK,
      now: () => 1000,
    });
    await ledger.grantEligibility("owner", "alice", "fixture");
    await ledger.grantPeriod("owner", {
      accountId: "alice",
      eventId: "fixture",
      startsAt: 1000,
      endsAt: 2000,
      subcredits: 1000000000,
      reason: "fixture",
      environment: "test",
    });
    let saved = false,
      access = true,
      dispatches = 0;
    const documents = {
      read: async (account: string, document: string) => {
        if (!access || account !== "alice" || document !== "doc")
          throw new Error("Document access denied");
        return {
          revision: saved ? 3 : 1,
          text: saved ? "Saved paragraph" : "Original",
        };
      },
      apply: async () => {
        saved = true;
        return { revision: 2, description: "Saved paragraph" };
      },
    };
    const executor = new ProAgentOperation(
      ledger,
      AGENT_BOOK,
      documents,
      async (request) => {
        dispatches++;
        const output =
          request.phase === "plan"
            ? { edits: ["Saved paragraph", "Next edit"] }
            : request.phase === "decision"
              ? { kind: "append" }
              : { text: "Saved paragraph" };
        return {
          kind: "completed",
          completion: AgentCompletion.parse({
            kind: "agent",
            phase: request.phase,
            output,
            usage: { input: 10, cachedInput: 0, output: 10 },
            actualCostNanoUsd: 100000,
          }),
        };
      },
    );
    const operation = await executor.reserve("alice", {
      documentId: "doc",
      revision: 1,
      prompt: "Synthetic edits",
      idempotencyKey: "A",
      acceptedMaximum: AGENT_BOOK.quote,
    });
    await executor.execute("alice", operation.id);
    const router = createAgentRouter({
      ledger: () => ledger,
      executor: () => undefined,
      documents: () => documents,
      selected: async () => false,
      dispatch: async () => {
        throw new Error("Recovery dispatched");
      },
    });
    const caller = router.createCaller({
      drizzle: db,
      headers: new Headers(),
      session: { user: { id: "alice" }, expires: "2099-01-01T00:00:00Z" },
      auth: { kind: "session" },
      schema,
    });
    const count = dispatches;
    const earlier = await caller.current({ documentId: "doc" });
    if (!earlier) throw new Error("Missing actual earlier report");
    expect(earlier.report.completed).toEqual([
      { revision: 2, description: "Saved paragraph" },
    ]);
    expect(earlier.report.incomplete).toEqual(["Next edit"]);
    expect(
      await caller.current({ documentId: "doc", idempotencyKey: "B" }),
    ).toBeNull();
    expect((await caller.operation({ id: operation.id })).report).toEqual(
      earlier.report,
    );
    expect(dispatches).toBe(count);
    access = false;
    await expect(
      caller.current({ documentId: "doc", idempotencyKey: "B" }),
    ).rejects.toThrow("Document access denied");
  } finally {
    client.close();
  }
});
