import { expect, test, mock } from "bun:test";
import { createClient } from "@libsql/client";
import { installServerRuntime } from "~/test/server-runtime";
import { ProLedger } from "./ledger";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const db = await installServerRuntime();
const { createNarrationRouter } = await import("../api/routers/narration");
const { ProNarration } = await import("./narration");
export function wav() {
  const b = Buffer.alloc(48044);
  b.write("RIFF");
  b.writeUInt32LE(48036, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(48000, 40);
  return b.toString("base64");
}
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Missing durable fixture value");
  return value;
}
async function fixture(transport?: import("./narration").NarrationTransport) {
  const client = createClient({ url: ":memory:" });
  for (const name of [
    "0015_private_pro",
    "0016_pro_billing_events",
    "0029_sandbox_billing",
    "0030_apple_sandbox",
    "0025_pro_narration",
  ])
    await client.executeMultiple(
      (
        await Bun.file(`../../packages/drizzle/drizzle/${name}.sql`).text()
      ).replaceAll("--> statement-breakpoint", ""),
    );
  let now = 1000;
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    now: () => now,
  });
  const grant = async (
    account: string,
    start = 1000,
    end = 2000,
    credits = 1_000_000_000,
  ) => {
    await ledger.grantEligibility("owner", account, "narration tester");
    return ledger.grantPeriod("owner", {
      accountId: account,
      eventId: `${account}:${start}`,
      startsAt: start,
      endsAt: end,
      subcredits: credits,
      reason: "fixture",
      environment: "test",
    });
  };
  let calls = 0;
  const executor = new ProNarration(
    ledger,
    transport ??
      (async () => {
        calls++;
        return {
          kind: "completed",
          completion: {
            kind: "narration_part",
            audio: wav(),
            usage: { input: 10, audio: 25 },
            actualCostNanoUsd: 155_000,
          },
        };
      }),
  );
  let mode = "pro";
  let text = "A calm reading.";
  let documentAccess = true;
  const router = createNarrationRouter({
    ledger: () => ledger,
    executor,
    source: async () => mode,
    read: async (_a: string, id: string) => {
      if (!documentAccess || id !== "doc")
        throw new Error("Document unavailable");
      return text;
    },
    dispatch: (account, id) => executor.execute(account, id),
  });
  const caller = (id: string | null) =>
    router.createCaller({
      drizzle: db,
      schema: {},
      session: id ? { user: { id, role: "admin" } } : null,
      auth: { kind: "session" },
      headers: new Headers(),
    } as never);
  return {
    client,
    ledger,
    executor,
    caller,
    grant,
    calls: () => calls,
    setAccess: (x: boolean) => (documentAccess = x),
    setMode: (x: string) => (mode = x),
    setText: (x: string) => (text = x),
    setNow: (x: number) => (now = x),
  };
}
test("authenticated selected Pro narration accepts a quote before paying; durable result wins losing refunds and free replay needs no entitlement", async () => {
  const f = await fixture();
  try {
    await expect(f.caller(null).quote({ documentId: "doc" })).rejects.toThrow();
    await expect(
      f.caller("alice").quote({ documentId: "doc" }),
    ).rejects.toThrow("entitlement");
    await f.ledger.grantEligibility("owner", "alice", "tester");
    await expect(
      f.caller("alice").quote({ documentId: "doc" }),
    ).rejects.toThrow("entitlement");
    await f.grant("alice");
    f.setMode("local");
    await expect(
      f.caller("alice").quote({ documentId: "doc" }),
    ).rejects.toThrow("Select Pro");
    f.setMode("pro");
    const q = await f.caller("alice").quote({ documentId: "doc" });
    expect(q).toMatchObject({
      maximum: 12_950_000,
      missing: 1,
      cached: 0,
      maxSeconds: 120,
    });
    await expect(
      f.caller("alice").generate({
        documentId: "doc",
        acceptedRevision: q.revision,
        acceptedPeriod: q.periodId,
        idempotencyKey: "one",
        acceptedMaximum: 0,
      }),
    ).rejects.toThrow("Accept");
    expect(f.calls()).toBe(0);
    const result = await f.caller("alice").generate({
      documentId: "doc",
      acceptedRevision: q.revision,
      acceptedPeriod: q.periodId,
      idempotencyKey: "one",
      acceptedMaximum: q.maximum,
    });
    expect(result).toMatchObject({
      state: "settled",
      charged: 103_334,
      made: 1,
      planned: 1,
    });
    expect(result.parts[0]?.audio).toBe(wav());
    expect(
      await f.ledger.settle(required(result.id), { kind: "technical_failure" }),
    ).toMatchObject({ state: "settled", charged: 103_334 });
    expect(
      await f.caller("alice").generate({
        documentId: "doc",
        acceptedRevision: q.revision,
        acceptedPeriod: q.periodId,
        idempotencyKey: "one",
        acceptedMaximum: q.maximum,
      }),
    ).toMatchObject({ id: result.id, state: "settled" });
    await f.ledger.revoke("owner", "alice", "exhaustion replay check");
    expect(await f.caller("alice").saved({ documentId: "doc" })).toMatchObject({
      state: "saved",
      charged: 0,
      made: 1,
    });
    await expect(
      f.caller("bob").operation({ id: required(result.id) }),
    ).rejects.toThrow();
    expect(f.calls()).toBe(1);
  } finally {
    f.client.close();
  }
});

test("technical partial failure refunds the entire job, exposes absorbed cost, and retry quotes only retained account-owned missing parts", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return calls === 2
      ? { kind: "failed", actualCostNanoUsd: 100_000 }
      : {
          kind: "completed",
          completion: {
            kind: "narration_part",
            audio: wav(),
            usage: { input: 10, audio: 25 },
            actualCostNanoUsd: 155_000,
          },
        };
  });
  try {
    await f.grant("alice");
    await f.grant("bob");
    f.setText(`${"a".repeat(500)}b`);
    const q = await f.caller("alice").quote({ documentId: "doc" });
    const failed = await f.caller("alice").generate({
      documentId: "doc",
      acceptedRevision: q.revision,
      acceptedPeriod: q.periodId,
      idempotencyKey: "partial",
      acceptedMaximum: q.maximum,
    });
    expect(failed).toMatchObject({
      state: "refunded",
      charged: 0,
      made: 1,
      planned: 2,
    });
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 1_000_000_000,
      reservedSubcredits: 0,
      providerCosts: { knownNanoUsd: 255_000, absorbedNanoUsd: 255_000 },
    });
    expect(await f.caller("alice").quote({ documentId: "doc" })).toMatchObject({
      maximum: 12_950_000,
      missing: 1,
      cached: 1,
    });
    expect(await f.caller("bob").quote({ documentId: "doc" })).toMatchObject({
      maximum: 25_900_000,
      missing: 2,
      cached: 0,
    });
    const retry = await f.caller("alice").generate({
      documentId: "doc",
      acceptedRevision: q.revision,
      acceptedPeriod: q.periodId,
      idempotencyKey: "retry",
      acceptedMaximum: 12_950_000,
    });
    expect(retry).toMatchObject({
      state: "settled",
      made: 2,
      charged: 103_334,
    });
    expect(calls).toBe(3);
    expect(
      (await f.ledger.entries("alice")).filter((e) => e.kind === "debit"),
    ).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

test("an uncertain paid part holds old-period credits and blocks retry until an owner reconciles actual output; continuation never regenerates confirmed parts", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return { kind: "unknown" };
  });
  try {
    const oldPeriod = await f.grant("alice");
    const q = await f.caller("alice").quote({ documentId: "doc" });
    const uncertain = await f.caller("alice").generate({
      documentId: "doc",
      acceptedRevision: q.revision,
      acceptedPeriod: q.periodId,
      idempotencyKey: "unknown",
      acceptedMaximum: q.maximum,
    });
    expect(uncertain).toMatchObject({ state: "unknown", made: 0 });
    await expect(
      f.caller("alice").generate({
        documentId: "doc",
        acceptedRevision: q.revision,
        acceptedPeriod: q.periodId,
        idempotencyKey: "unsafe-retry",
        acceptedMaximum: q.maximum,
      }),
    ).rejects.toThrow("reconciling");
    const attempt = required(
      (await f.ledger.attempts("alice", required(uncertain.id)))[0],
    );
    f.setNow(2000);
    await f.grant("alice", 2000, 3000);
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 1_000_000_000,
      previousPeriodReservedSubcredits: 12_950_000,
    });
    const completion = {
      kind: "narration_part" as const,
      audio: wav(),
      usage: { input: 10, audio: 25 },
      actualCostNanoUsd: 155_000,
    };
    await expect(
      f.caller("alice").reconcilePart({
        id: required(uncertain.id),
        attemptId: String(attempt.id),
        completion,
        evidence: "provider output confirmed",
      }),
    ).rejects.toThrow("Owner");
    const done = await f.caller("owner").reconcilePart({
      id: required(uncertain.id),
      attemptId: String(attempt.id),
      completion,
      evidence: "provider output confirmed",
    });
    expect(done).toMatchObject({ state: "settled", made: 1, charged: 103_334 });
    expect(
      (await f.ledger.entries("alice")).filter((e) => e.kind === "debit")[0]
        ?.period_id,
    ).toBe(oldPeriod);
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 1_000_000_000,
      previousPeriodReservedSubcredits: 0,
      providerCosts: { knownNanoUsd: 155_000, unknownExposureNanoUsd: 0 },
    });
    expect(calls).toBe(1);
  } finally {
    f.client.close();
  }
});

test("legacy cloud narration routes reject unmetered new generation without affecting saved manifest reads", async () => {
  const { ttsRouter } = await import("../api/routers/tts");
  const caller = ttsRouter.createCaller({
    drizzle: db,
    schema: {},
    session: { user: { id: "ordinary" } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
  await expect(
    caller.startDocumentTts({ documentId: "doc", provider: "google" }),
  ).rejects.toThrow("Coming soon");
  await expect(
    caller.startArticleTts({ articleId: "doc", provider: "openai" }),
  ).rejects.toThrow("Coming soon");
});

test("rate snapshots and an accepted revision remain stable across quote acceptance instead of spending on edited text", async () => {
  const f = await fixture();
  try {
    await f.grant("alice");
    const q = await f.caller("alice").quote({ documentId: "doc" });
    f.setText("A different reading.");
    await expect(
      f.caller("alice").generate({
        documentId: "doc",
        acceptedRevision: q.revision,
        acceptedPeriod: q.periodId,
        idempotencyKey: "changed",
        acceptedMaximum: q.maximum,
      }),
    ).rejects.toThrow("revision");
    expect(f.calls()).toBe(0);
  } finally {
    f.client.close();
  }
});

test("quote acceptance cannot cross entitlement periods even if the document and maximum are unchanged", async () => {
  const f = await fixture();
  try {
    await f.grant("alice");
    const q = await f.caller("alice").quote({ documentId: "doc" });
    f.setNow(2000);
    await f.grant("alice", 2000, 3000);
    await expect(
      f.caller("alice").generate({
        documentId: "doc",
        acceptedRevision: q.revision,
        acceptedPeriod: q.periodId,
        idempotencyKey: "renewal",
        acceptedMaximum: q.maximum,
      }),
    ).rejects.toThrow("period");
    expect(f.calls()).toBe(0);
  } finally {
    f.client.close();
  }
});

test("replayed durable step with a committed paid fence and no persisted output reports reconciliation instead of reissuing a request", async () => {
  const f = await fixture();
  try {
    await f.grant("alice");
    const q = await f.caller("alice").quote({ documentId: "doc" });
    const prepared = await f.executor.prepare(
      "alice",
      "doc",
      "A calm reading.",
      "crash",
      q.maximum,
      q.revision,
      q.periodId,
    );
    await f.ledger.claim(required(prepared.id));
    const plan = await f.ledger.narrationPlan("alice", required(prepared.id));
    await f.ledger.startAttempt(
      required(prepared.id),
      required(plan.plan[0]).hash,
    );
    f.setNow(200_000);
    const replayed = await f.executor.execute("alice", required(prepared.id));
    expect(replayed).toMatchObject({ state: "unknown", made: 0 });
    expect(f.calls()).toBe(0);
    expect(await f.ledger.status("alice")).toMatchObject({
      previousPeriodReservedSubcredits: 12_950_000,
      providerCosts: { unknownExposureNanoUsd: 38_850_000 },
    });
  } finally {
    f.client.close();
  }
});

test("a confirmed late output from the original executor resolves a stale uncertain fence and wins cancellation without another paid request", async () => {
  let entered!: () => void,
    release!: (x: import("./narration").NarrationOutcome) => void;
  const started = new Promise<void>((r) => (entered = r));
  const result = new Promise<import("./narration").NarrationOutcome>(
    (r) => (release = r),
  );
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    entered();
    return result;
  });
  try {
    await f.grant("alice");
    const q = await f.caller("alice").quote({ documentId: "doc" });
    const pending = f.caller("alice").generate({
      documentId: "doc",
      acceptedRevision: q.revision,
      acceptedPeriod: q.periodId,
      idempotencyKey: "late",
      acceptedMaximum: q.maximum,
    });
    await started;
    const latest = await f.caller("alice").latest({ documentId: "doc" });
    f.setNow(200_000);
    expect(
      await f.executor.execute("alice", required(latest).id),
    ).toMatchObject({
      state: "unknown",
    });
    await f.caller("alice").cancel({ id: required(latest).id });
    release({
      kind: "completed",
      completion: {
        kind: "narration_part",
        audio: wav(),
        usage: { input: 10, audio: 25 },
        actualCostNanoUsd: 155_000,
      },
    });
    expect(await pending).toMatchObject({
      state: "settled",
      made: 1,
      charged: 103_334,
    });
    expect(calls).toBe(1);
  } finally {
    f.client.close();
  }
});

test("revoked document access denies narration operation output even to its account owner", async () => {
  const f = await fixture();
  try {
    await f.grant("alice");
    const q = await f.caller("alice").quote({ documentId: "doc" });
    const op = await f.caller("alice").generate({
      documentId: "doc",
      idempotencyKey: "access-check",
      acceptedMaximum: q.maximum,
      acceptedRevision: q.revision,
      acceptedPeriod: q.periodId,
    });
    expect(
      (await f.caller("alice").operation({ id: required(op.id) })).state,
    ).toBe("settled");
    f.setAccess(false);
    await expect(
      f.caller("alice").operation({ id: required(op.id) }),
    ).rejects.toThrow("Document unavailable");
  } finally {
    f.client.close();
  }
});
