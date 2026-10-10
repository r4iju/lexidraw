import { test, expect, mock } from "bun:test";
import { createClient } from "@libsql/client";
import { ProLedger } from "./ledger";
import { fixtureImage } from "~/test/image-fixture";
import { IMAGE_FIXTURE_PRICEBOOK } from "~/lib/images/contracts";
import { AGENT_BOOK } from "~/lib/agent/contracts";
import { ProAgentOperation } from "./agent-operation";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const { installServerRuntime } = await import("~/test/server-runtime");
const db = await installServerRuntime();
const { createAgentRouter } = await import("../api/routers/pro-agent");
test("synthetic complete image bound belongs to parent quote; one action includes planning, paid search, image and saved mutation, never a child debit", async () => {
  const client = createClient({ url: ":memory:" });
  for (const name of [
    "0015_private_pro",
    "0016_pro_billing_events",
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
    now: () => 1000,
  });
  await ledger.grantEligibility("owner", "alice", "fixture");
  await ledger.grantPeriod("owner", {
    accountId: "alice",
    eventId: "one",
    startsAt: 1000,
    endsAt: 2000,
    subcredits: 1000000000,
    reason: "fixture",
    environment: "test",
  });
  let calls = 0,
    images = 0;
  let revision = 1;
  const executor = new ProAgentOperation(
    ledger,
    {
      ...AGENT_BOOK,
      provenance: "deterministic-whole-action-fixture",
      image: IMAGE_FIXTURE_PRICEBOOK,
      maxImageSteps: 1,
      maxAttempts: 16,
      maximumNanoUsd: 259888000,
      quote: 86629334,
    },
    {
      read: async () => ({ revision, text: "Original" }),
      apply: async (_a, _d, _k, _r, edit) => {
        expect(edit.kind).toBe("image");
        images++;
        return { revision: ++revision, description: "Image inserted" };
      },
    },
    async (request) => {
      calls++;
      expect((await ledger.status("alice")).reservedSubcredits).toBe(86629334);
      const image = {
        kind: "image",
        image: fixtureImage(),
        usage: {
          inputTokens: 10,
          thinkingTokens: 20,
          textOutputTokens: 5,
          outputImages: 1,
        },
        actualCostNanoUsd: 134035000,
      };
      const output =
        request.phase === "plan"
          ? { edits: ["Add image"] }
          : request.phase === "decision"
            ? {
                kind: calls === 2 ? "search" : calls === 4 ? "image" : "done",
                query: "tree",
              }
            : request.phase === "search"
              ? { results: [] }
              : image;
      return {
        kind: "completed",
        completion: {
          kind: "agent",
          phase: request.phase,
          output,
          usage: { input: 100, cachedInput: 0, output: 10 },
          actualCostNanoUsd:
            request.phase === "image"
              ? 134035000
              : request.phase === "search"
                ? 5000000
                : 120000,
        },
      };
    },
  );
  const router = createAgentRouter({
    ledger: () => ledger,
    executor: () => executor,
    selected: async () => true,
    dispatch: (a, id) => executor.execute(a, id),
  });
  const caller = router.createCaller({
    drizzle: db,
    headers: new Headers(),
    session: { user: { id: "alice" }, expires: "2099" },
  } as never);
  try {
    const result = await caller.start({
      documentId: "doc",
      revision: 1,
      prompt: "Add a tree image",
      idempotencyKey: "one",
      acceptedMaximum: 86629334,
    });
    expect(result.report.status).toBe("complete");
    expect(images).toBe(1);
    expect(result.operation.charged).toBe(46505000);
    expect((await ledger.status("alice")).history).toHaveLength(1);
    expect(calls).toBe(6);
  } finally {
    client.close();
  }
});
