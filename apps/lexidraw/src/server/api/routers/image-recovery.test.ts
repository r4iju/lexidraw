import { expect, mock, test } from "bun:test";
import { createClient } from "@libsql/client";
import { installServerRuntime } from "~/test/server-runtime";
import { ProLedger } from "~/server/pro/ledger";
import { ProImageOperation } from "~/server/pro/image-operation";
import { supplierFixture } from "~/test/supplier-fixture";
import { IMAGE_FIXTURE_PRICEBOOK } from "~/lib/images/contracts";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const db = await installServerRuntime();
const { schema } = await import("@packages/drizzle");
const { createImagePowerRouter } = await import("./image-power");
test("owned image read survives removal of generation executor without reserve or dispatch", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    for (const migration of [
      "0015_private_pro",
      "0016_pro_billing_events",
      "0029_sandbox_billing",
      "0030_apple_sandbox",
    ])
      await client.executeMultiple(
        (
          await Bun.file(
            `../../packages/drizzle/drizzle/${migration}.sql`,
          ).text()
        ).replaceAll("--> statement-breakpoint", ""),
      );
    const ledger = new ProLedger(client, {
      ownerAccountIds: ["owner"],
      supplierBooks: supplierFixture,
      imageBook: () => IMAGE_FIXTURE_PRICEBOOK,
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
    let calls = 0;
    const executor = new ProImageOperation(
      ledger,
      IMAGE_FIXTURE_PRICEBOOK,
      async () => {
        calls++;
        return { kind: "unknown" };
      },
    );
    const owned = await executor.start("alice", {
      idempotencyKey: "original-image",
      prompt: "Synthetic",
      acceptedMaximum: 60000000,
    });
    const router = createImagePowerRouter({
      ledger: () => ledger,
      images: () => {
        throw new Error("No upload");
      },
      source: async () => "local",
    });
    const caller = router.createCaller({
      drizzle: db,
      schema,
      session: { user: { id: "alice" }, expires: "2099-01-01T00:00:00Z" },
      auth: { kind: "session" },
      headers: new Headers(),
    });
    expect((await caller.operation({ id: owned.id })).id).toBe(owned.id);
    expect(
      (await caller.current({ idempotencyKey: "original-image" }))?.id,
    ).toBe(owned.id);
    expect(
      await caller.current({ idempotencyKey: "missing-image" }),
    ).toBeNull();
    const other = router.createCaller({
      drizzle: db,
      schema,
      session: { user: { id: "bob" }, expires: "2099-01-01T00:00:00Z" },
      auth: { kind: "session" },
      headers: new Headers(),
    });
    expect(
      await other.current({ idempotencyKey: "original-image" }),
    ).toBeNull();
    expect(calls).toBe(1);
  } finally {
    client.close();
  }
});
