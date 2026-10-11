import { makeSupplierContract } from "./supplier-contract";
import { PRICEBOOK } from "./contracts";
import { supplierFixture } from "~/test/supplier-fixture";
import { expect, mock, test } from "bun:test";
import { createClient } from "@libsql/client";
import { ProLedger } from "./ledger";
import { ProChat } from "./chat";
import { ProTextOperation } from "./operation";
mock.module("server-only", () => ({}));
const { createProChatTransport } = await import("./chat-provider");
async function fixture() {
  const client = createClient({ url: ":memory:" });
  for (const migration of [
    "0015_private_pro.sql",
    "0016_pro_billing_events.sql",
    "0029_sandbox_billing.sql",
    "0030_apple_sandbox.sql",
  ])
    await client.executeMultiple(
      (
        await Bun.file(
          new URL(
            `../../../../../packages/drizzle/drizzle/${migration}`,
            import.meta.url,
          ),
        ).text()
      ).replaceAll("--> statement-breakpoint", ""),
    );
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    now: () => 1000,
  });
  await ledger.grantEligibility("owner", "alice", "tester");
  await ledger.grantPeriod("owner", {
    accountId: "alice",
    eventId: "trial",
    startsAt: 1000,
    endsAt: 2000,
    subcredits: 10000000,
    reason: "trial",
    environment: "test",
  });
  return { ledger, client };
}
test("Pro chat quotes period rates, accepts once, streams through the paid fence and replays without another provider request", async () => {
  const f = await fixture();
  let calls = 0;
  const chat = new ProChat(
    f.ledger,
    new ProTextOperation(f.ledger, async (text, _signal, context) => {
      calls++;
      expect(JSON.parse(text).messages).toEqual([
        { role: "user", content: "Hello" },
      ]);
      expect(
        (await f.ledger.operation("alice", context.operationId)).state,
      ).toBe("running");
      context.onText?.("Hello ");
      context.onText?.("Hello back.");
      return {
        kind: "completed",
        completion: {
          text: "Hello back.",
          usage: { input: 100, cachedInput: 0, output: 4 },
          actualCostNanoUsd: 93000,
        },
      };
    }),
  );
  try {
    const quote = await chat.quote("alice", { prompt: "Hello" });
    expect(quote.maximum).toBe(1792000);
    const operation = await chat.accept(
      "alice",
      "same-turn",
      { prompt: "Hello" },
      quote,
    );
    const updates: string[] = [];
    const result = await chat.stream(
      "alice",
      operation.id,
      { prompt: "Hello" },
      (text) => updates.push(text),
    );
    expect(updates).toEqual(["Hello ", "Hello back."]);
    expect(result).toMatchObject({
      state: "settled",
      charged: 31000,
      result: "Hello back.",
    });
    expect(
      await chat.accept("alice", "same-turn", { prompt: "Hello" }, quote),
    ).toMatchObject({ id: operation.id });
    await chat.stream("alice", operation.id, { prompt: "Hello" }, () => {});
    expect(calls).toBe(1);
    await expect(
      chat.stream("bob", operation.id, { prompt: "Hello" }, () => {}),
    ).rejects.toThrow();
  } finally {
    f.client.close();
  }
});

test("chat rejects encoded credential material before reservation", async () => {
  const f = await fixture();
  const chat = new ProChat(
    f.ledger,
    new ProTextOperation(f.ledger, async () => ({ kind: "unknown" })),
  );
  try {
    await expect(
      chat.quote("alice", {
        prompt: Array.from(
          "sk-or-v1-distinctive-fixture-only-key",
          (char) => "%" + char.charCodeAt(0).toString(16),
        ).join(""),
      }),
    ).rejects.toThrow("Credential");
    expect((await f.ledger.status("alice")).reservedSubcredits).toBe(0);
  } finally {
    f.client.close();
  }
});

test("terminal failed chat after a partial delta refunds the whole customer operation and preserves supplier cost", async () => {
  const f = await fixture();
  let calls = 0;
  const updates: string[] = [];
  const transport = createProChatTransport({
    authorize: async (scope) =>
      makeSupplierContract(
        scope.feature === "autocomplete" ? "autocomplete" : "chat",
        PRICEBOOK,
        "test-injection",
      ),
    resolveServerKey: () => "fake-system-key",
    fetch: async () => {
      calls++;
      const events = [
        { type: "response.output_text.delta", delta: "Partial " },
        {
          type: "response.failed",
          response: {
            id: "failed-fixture",
            status: "failed",
            error: {
              code: "server_error",
              message: "Private supplier diagnostic",
            },
            usage: {
              input_tokens: 100,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 4,
            },
          },
        },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  try {
    const chat = new ProChat(
      f.ledger,
      new ProTextOperation(f.ledger, transport),
    );
    const input = { prompt: "Hello" };
    const quote = await chat.quote("alice", input);
    const op = await chat.accept("alice", "failed", input, quote);
    const result = await chat.stream("alice", op.id, input, (text) =>
      updates.push(text),
    );
    expect(result).toMatchObject({
      state: "refunded",
      charged: 0,
      result: null,
    });
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 10000000,
      reservedSubcredits: 0,
      providerCosts: { knownNanoUsd: 93000, unknownExposureNanoUsd: 0 },
    });
    expect(updates).toEqual(["Partial "]);
    expect(JSON.stringify(result)).not.toContain("Private supplier diagnostic");
    await chat.stream("alice", op.id, input, () => {});
    expect(calls).toBe(1);
  } finally {
    f.client.close();
  }
});

test("D2 paid follow-up and full attachment keep the accepted maximum and original replay identity", async () => {
  const f = await fixture();
  const bodies: unknown[] = [];
  const transport = createProChatTransport({
    authorize: async () =>
      makeSupplierContract("chat", PRICEBOOK, "test-injection"),
    resolveServerKey: () => "fake-system-key",
    fetch: async (request) => {
      bodies.push(await request.json());
      return new Response(
        [
          { type: "response.output_text.delta", delta: "Yes indeed." },
          {
            type: "response.completed",
            response: {
              id: "fixture",
              status: "completed",
              usage: {
                input_tokens: 100,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 4,
              },
            },
          },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const chat = new ProChat(f.ledger, new ProTextOperation(f.ledger, transport));
  try {
    for (const [index, input] of [
      {
        prompt: "Why?",
        messages: [
          { role: "user", content: "Explain" },
          { role: "assistant", content: "a".repeat(2000) },
        ],
      },
      {
        prompt: "Read",
        files: [
          { name: "note.txt", type: "text/plain", text: "b".repeat(1500) },
        ],
      },
    ].entries()) {
      const quote = await chat.quote("alice", input);
      expect(quote.maximum).toBe(1792000);
      const operation = await chat.accept("alice", `d2-${index}`, input, quote);
      const result = await chat.stream("alice", operation.id, input, () => {});
      expect(result).toMatchObject({
        state: "settled",
        result: "Yes indeed.",
        charged: 31000,
      });
      expect(
        await chat.accept("alice", `d2-${index}`, input, quote),
      ).toMatchObject({ id: operation.id });
      await chat.stream("alice", operation.id, input, () => {});
    }
    expect(bodies).toMatchObject([
      {
        max_output_tokens: 512,
        input: [
          { content: "Explain" },
          { content: "a".repeat(2000) },
          { content: "Why?" },
        ],
      },
      {
        max_output_tokens: 512,
        input: [
          { content: "Read\n\nAttachment note.txt:\n" + "b".repeat(1500) },
        ],
      },
    ]);
  } finally {
    f.client.close();
  }
});
