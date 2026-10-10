import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { ProLedger } from "./ledger";
import { IMAGE_FIXTURE_PRICEBOOK } from "~/lib/images/contracts";
import { ProImageOperation } from "./image-operation";
import { fixtureImage } from "~/test/image-fixture";
async function fixture() {
  const client = createClient({ url: ":memory:" });
  for (const migration of [
    "0015_private_pro",
    "0016_pro_billing_events",
    "0029_sandbox_billing",
    "0030_apple_sandbox",
  ])
    await client.executeMultiple(
      (
        await Bun.file(`../../packages/drizzle/drizzle/${migration}.sql`).text()
      ).replaceAll("--> statement-breakpoint", ""),
    );
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    now: () => 1000,
  });
  await ledger.grantEligibility("owner", "alice", "image fixture");
  await ledger.grantPeriod("owner", {
    accountId: "alice",
    eventId: "image",
    startsAt: 1000,
    endsAt: 2000,
    subcredits: 1_000_000_000,
    reason: "fixture",
    environment: "test",
  });
  return { client, ledger };
}
test("image action requires accepted maximum; durable image completion wins losing refund and replay never regenerates", async () => {
  const { client, ledger } = await fixture();
  let calls = 0;
  const executor = new ProImageOperation(
    ledger,
    IMAGE_FIXTURE_PRICEBOOK,
    async () => {
      calls++;
      expect((await ledger.status("alice")).reservedSubcredits).toBe(
        60_000_000,
      );
      return {
        kind: "completed",
        completion: {
          kind: "image",
          image: fixtureImage(),
          usage: {
            inputTokens: 10,
            thinkingTokens: 20,
            textOutputTokens: 5,
            outputImages: 1,
          },
          actualCostNanoUsd: 134_035_000,
        },
      };
    },
  );
  try {
    await expect(
      executor.start("alice", {
        idempotencyKey: "declined",
        prompt: "tree",
        acceptedMaximum: 0,
      }),
    ).rejects.toThrow("Accept the maximum");
    expect(calls).toBe(0);
    const result = await executor.start("alice", {
      idempotencyKey: "one",
      prompt: "tree",
      acceptedMaximum: 60_000_000,
    });
    expect(result).toMatchObject({
      state: "settled",
      quote: 60_000_000,
      charged: 44_678_334,
      feature: "image",
    });
    expect(JSON.parse(result.result ?? "null")).toMatchObject({
      mimeType: "image/png",
      width: 1024,
      height: 1024,
    });
    expect(
      await ledger.settle(result.id, { kind: "technical_failure" }),
    ).toMatchObject({ state: "settled", charged: 44_678_334 });
    expect(
      await executor.start("alice", {
        idempotencyKey: "one",
        prompt: "tree",
        acceptedMaximum: 60_000_000,
      }),
    ).toMatchObject({ id: result.id });
    expect(calls).toBe(1);
    await executor.start("alice", {
      idempotencyKey: "regenerate",
      prompt: "tree",
      acceptedMaximum: 60_000_000,
    });
    expect(calls).toBe(2);
    await expect(
      executor.start("alice", {
        idempotencyKey: "large",
        prompt: "😀".repeat(376),
        acceptedMaximum: 60_000_000,
      }),
    ).rejects.toThrow("bounded prompt");
    await expect(
      executor.start("alice", {
        idempotencyKey: "config",
        prompt: "tree",
        acceptedMaximum: 60_000_000,
        model: "arbitrary",
      } as never),
    ).rejects.toThrow();
  } finally {
    client.close();
  }
});

test("incomplete modality rate snapshot fails before reserving or dispatching paid work", async () => {
  const { client, ledger } = await fixture();
  try {
    expect(
      () =>
        new ProImageOperation(
          ledger,
          { ...IMAGE_FIXTURE_PRICEBOOK, quote: 1 },
          async () => {
            throw new Error("must not dispatch");
          },
        ),
    ).toThrow();
    expect((await ledger.status("alice")).reservedSubcredits).toBe(0);
  } finally {
    client.close();
  }
});

test("image customer rate snapshot cannot change inside an entitlement period", async () => {
  const { client, ledger } = await fixture();
  try {
    await ledger.reserve(
      "alice",
      "first",
      "first",
      "image",
      IMAGE_FIXTURE_PRICEBOOK,
    );
    await expect(
      ledger.reserve("alice", "changed", "changed", "image", {
        ...IMAGE_FIXTURE_PRICEBOOK,
        version: "changed",
      }),
    ).rejects.toThrow("period");
  } finally {
    client.close();
  }
});
