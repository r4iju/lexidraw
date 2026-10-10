import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { ProLedger } from "./ledger";
import { ProChat } from "./chat";
import { ProTextOperation } from "./operation";
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
