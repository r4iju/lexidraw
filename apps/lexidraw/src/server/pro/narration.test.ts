import { supplierFixture } from "~/test/supplier-fixture";
import { expect, test, mock } from "bun:test";
import { createClient } from "@libsql/client";
import { installServerRuntime } from "~/test/server-runtime";
import { ProLedger } from "./ledger";
import { NARRATION_BOOK, NarrationBook } from "~/lib/narration/contracts";
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
  let ratebook = NarrationBook.parse(NARRATION_BOOK);
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    now: () => now,
    narrationBook: () => ratebook,
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
  const routerDeps = {
    ledger: () => ledger,
    executor: () => executor,
    source: async () => mode,
    read: async (_a: string, id: string) => {
      if (!documentAccess || id !== "doc")
        throw new Error("Document unavailable");
      return text;
    },
    dispatch: (account: string, id: string) => executor.execute(account, id),
  };
  const router = createNarrationRouter(routerDeps);
  const readerRouter = createNarrationRouter({
    ...routerDeps,
    executor: undefined,
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
    reader: (id: string | null) =>
      readerRouter.createCaller({
        drizzle: db,
        schema: {},
        session: id ? { user: { id, role: "admin" } } : null,
        auth: { kind: "session" },
        headers: new Headers(),
      } as never),
    calls: () => calls,
    setAccess: (x: boolean) => (documentAccess = x),
    setMode: (x: string) => (mode = x),
    setText: (x: string) => (text = x),
    setNow: (x: number) => (now = x),
    updateRates: () =>
      (ratebook = {
        ...ratebook,
        version: "synthetic-narration-v2",
        inputNanoUsd: 2000,
        audioNanoUsd: 24000,
      }),
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

test("saved job restore survives edited text, unavailable generation and revoked Pro while current document access still governs delivery", async () => {
  const f = await fixture();
  try {
    await f.grant("alice", 1000, 2000, 12_950_000);
    const q = await f.caller("alice").quote({ documentId: "doc" });
    const done = await f.caller("alice").generate({
      documentId: "doc",
      idempotencyKey: "saved",
      acceptedMaximum: q.maximum,
      acceptedRevision: q.revision,
      acceptedPeriod: q.periodId,
    });
    f.setText("Edited document after recording.");
    const exhausted = await f.caller("alice").quote({ documentId: "doc" });
    await expect(
      f.caller("alice").generate({
        documentId: "doc",
        idempotencyKey: "exhausted",
        acceptedMaximum: exhausted.maximum,
        acceptedRevision: exhausted.revision,
        acceptedPeriod: exhausted.periodId,
      }),
    ).rejects.toThrow("Insufficient credits");
    await f.ledger.revoke("owner", "alice", "saved playback without Pro");
    f.setMode("local");
    const before = await f.ledger.entries("alice");
    const latest = required(
      await f.reader("alice").latest({ documentId: "doc" }),
    );
    expect(latest.id).toBe(required(done.id));
    const restored = await f.reader("alice").operation({ id: latest.id });
    expect(restored).toMatchObject({
      state: "settled",
      made: 1,
      charged: 103_334,
    });
    expect(restored.parts[0]).toMatchObject({
      text: "A calm reading.",
      audio: wav(),
    });
    expect(await f.reader("alice").saved({ documentId: "doc" })).toEqual(
      restored,
    );
    expect(await f.ledger.entries("alice")).toEqual(before);
    expect(f.calls()).toBe(1);
    await expect(
      f.reader("bob").operation({ id: latest.id }),
    ).rejects.toThrow();
    await expect(f.reader(null).operation({ id: latest.id })).rejects.toThrow();
    f.setAccess(false);
    await expect(
      f.reader("alice").operation({ id: latest.id }),
    ).rejects.toThrow("Document unavailable");
    await expect(
      f.reader("alice").saved({ documentId: "doc" }),
    ).rejects.toThrow("Document unavailable");
  } finally {
    f.client.close();
  }
});

test("period creation pins narration customer rates through updates, renewal quotes new rates and durable old work settles its accepted book", async () => {
  const f = await fixture(async () => ({ kind: "unknown" }));
  try {
    const period = await f.grant("alice");
    f.updateRates();
    const q = await f.caller("alice").quote({ documentId: "doc" });
    expect(q).toMatchObject({
      periodId: period,
      version: "private-narration-2026-10-v1",
      maximum: 12_950_000,
    });
    const old = await f.caller("alice").generate({
      documentId: "doc",
      idempotencyKey: "historical",
      acceptedMaximum: q.maximum,
      acceptedRevision: q.revision,
      acceptedPeriod: q.periodId,
    });
    expect(old.state).toBe("unknown");
    f.setNow(2000);
    const renewal = await f.grant("alice", 2000, 3000);
    const renewed = await f.caller("alice").quote({ documentId: "doc" });
    expect(renewed).toMatchObject({
      periodId: renewal,
      version: "synthetic-narration-v2",
      maximum: 25_900_000,
    });
    const attempt = required(
      (await f.ledger.attempts("alice", required(old.id)))[0],
    );
    await f.ledger.reconcileNarrationPart(
      "owner",
      required(old.id),
      String(attempt.id),
      {
        kind: "narration_part",
        audio: wav(),
        usage: { input: 10, audio: 25 },
        actualCostNanoUsd: 155_000,
      },
      "historical durable response",
    );
    const restarted = new ProNarration(
      new ProLedger(f.client, f.ledger.config),
      async () => {
        throw new Error("No paid replay");
      },
    );
    expect(await restarted.recover("alice", required(old.id))).toMatchObject({
      state: "settled",
      charged: 103_334,
      quote: 12_950_000,
    });
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 1_000_000_000,
      previousPeriodReservedSubcredits: 0,
      providerCosts: { knownNanoUsd: 155_000, unknownExposureNanoUsd: 0 },
    });
    f.setText("A new reading.");
    const fresh = await f.caller("alice").quote({ documentId: "doc" });
    await expect(
      f.caller("alice").generate({
        documentId: "doc",
        idempotencyKey: "stale-maximum",
        acceptedMaximum: 12_950_000,
        acceptedRevision: fresh.revision,
        acceptedPeriod: fresh.periodId,
      }),
    ).rejects.toThrow("Accept");
    const next = await f.caller("alice").generate({
      documentId: "doc",
      idempotencyKey: "new-rate",
      acceptedMaximum: fresh.maximum,
      acceptedRevision: fresh.revision,
      acceptedPeriod: fresh.periodId,
    });
    expect(await f.ledger.status("alice")).toMatchObject({
      reservedSubcredits: 25_900_000,
      availableSubcredits: 974_100_000,
    });
    const nextAttempt = required(
      (await f.ledger.attempts("alice", required(next.id)))[0],
    );
    await f.ledger.reconcileNarrationPart(
      "owner",
      required(next.id),
      String(nextAttempt.id),
      {
        kind: "narration_part",
        audio: wav(),
        usage: { input: 10, audio: 25 },
        actualCostNanoUsd: 155_000,
      },
      "new-rate confirmed response",
    );
    expect(await restarted.recover("alice", required(next.id))).toMatchObject({
      state: "settled",
      charged: 206_667,
      quote: 25_900_000,
    });
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 999_793_333,
      providerCosts: { knownNanoUsd: 310_000 },
    });
  } finally {
    f.client.close();
  }
});

test("historical saved parts remain readable when an edited document exceeds generation bounds", async () => {
  let calls = 0;
  const f = await fixture(async () =>
    ++calls === 2
      ? { kind: "failed", actualCostNanoUsd: 10 }
      : {
          kind: "completed",
          completion: {
            kind: "narration_part",
            audio: wav(),
            usage: { input: 10, audio: 25 },
            actualCostNanoUsd: 155_000,
          },
        },
  );
  try {
    await f.grant("alice");
    f.setText(`${"a".repeat(500)}b`);
    const q = await f.caller("alice").quote({ documentId: "doc" });
    const partial = await f.caller("alice").generate({
      documentId: "doc",
      idempotencyKey: "parts",
      acceptedMaximum: q.maximum,
      acceptedRevision: q.revision,
      acceptedPeriod: q.periodId,
    });
    f.setText("edited".repeat(2000));
    const before = await f.ledger.entries("alice");
    const read = await f.reader("alice").saved({ documentId: "doc" });
    expect(read).toMatchObject({
      id: partial.id,
      state: "refunded",
      made: 1,
      charged: 0,
    });
    expect(read.parts[0]?.audio).toBe(wav());
    expect(await f.ledger.entries("alice")).toEqual(before);
    expect(calls).toBe(2);
  } finally {
    f.client.close();
  }
});

test("a later empty failed job cannot hide a previously completed saved recording after edits", async () => {
  let calls = 0;
  const f = await fixture(async () =>
    ++calls === 1
      ? {
          kind: "completed",
          completion: {
            kind: "narration_part",
            audio: wav(),
            usage: { input: 10, audio: 25 },
            actualCostNanoUsd: 155_000,
          },
        }
      : { kind: "failed", actualCostNanoUsd: 10 },
  );
  try {
    await f.grant("alice");
    const generate = async (key: string) => {
      const q = await f.caller("alice").quote({ documentId: "doc" });
      return f.caller("alice").generate({
        documentId: "doc",
        idempotencyKey: key,
        acceptedMaximum: q.maximum,
        acceptedRevision: q.revision,
        acceptedPeriod: q.periodId,
      });
    };
    const done = await generate("complete");
    f.setText("Later new reading.");
    expect(await generate("failed")).toMatchObject({
      state: "refunded",
      made: 0,
    });
    f.setText("Final edited text.");
    expect(await f.reader("alice").saved({ documentId: "doc" })).toMatchObject({
      id: done.id,
      state: "settled",
      made: 1,
    });
    expect(calls).toBe(2);
  } finally {
    f.client.close();
  }
});

test("useful cached later parts are delivered even when the earlier missing part fails", async () => {
  let calls = 0;
  const f = await fixture(async () =>
    ++calls === 1
      ? {
          kind: "completed",
          completion: {
            kind: "narration_part",
            audio: wav(),
            usage: { input: 10, audio: 25 },
            actualCostNanoUsd: 155_000,
          },
        }
      : { kind: "failed", actualCostNanoUsd: 10 },
  );
  try {
    await f.grant("alice");
    f.setText("b");
    const generate = async (key: string) => {
      const q = await f.caller("alice").quote({ documentId: "doc" });
      return f.caller("alice").generate({
        documentId: "doc",
        idempotencyKey: key,
        acceptedMaximum: q.maximum,
        acceptedRevision: q.revision,
        acceptedPeriod: q.periodId,
      });
    };
    await generate("cache-last");
    f.setText(`${"a".repeat(500)}b`);
    const failed = await generate("missing-first");
    expect(failed).toMatchObject({
      state: "refunded",
      made: 1,
      planned: 2,
      charged: 0,
    });
    expect(failed.parts[0]).toMatchObject({ text: "b", audio: wav() });
    f.setText("Edited again.");
    expect(await f.reader("alice").saved({ documentId: "doc" })).toMatchObject({
      id: failed.id,
      made: 1,
    });
    expect(calls).toBe(2);
  } finally {
    f.client.close();
  }
});

test("authenticated narration completion and historical saved parts validate against the attempt supplier contract after rates change", async () => {
  const f = await fixture(async (_text, _signal, scope) => {
    expect(scope.supplier.maximumNanoUsd).toBe(77700000);
    return {
      kind: "completed",
      completion: {
        kind: "narration_part",
        audio: wav(),
        usage: { input: 2850, audio: 3000 },
        actualCostNanoUsd: 77700000,
      },
    };
  });
  try {
    await f.grant("alice");
    f.ledger.config.supplierBooks = () => ({
      verification: "test-injection",
      narration: {
        ...NARRATION_BOOK,
        version: "supplier-narration-v2",
        inputNanoUsd: 2000,
        audioNanoUsd: 24000,
      },
    });
    const q = await f.caller("alice").quote({ documentId: "doc" });
    const op = await f.caller("alice").generate({
      documentId: "doc",
      idempotencyKey: "supplier-raised",
      acceptedMaximum: q.maximum,
      acceptedRevision: q.revision,
      acceptedPeriod: q.periodId,
    });
    expect(op).toMatchObject({ state: "settled", charged: 12950000 });
    f.ledger.config.supplierBooks = supplierFixture;
    const reopened = new ProLedger(f.client, f.ledger.config);
    const part = await reopened.narrationPart(
      "alice",
      String((await reopened.attempts("alice", required(op.id)))[0]?.id),
    );
    expect(part.actualCostNanoUsd).toBe(77700000);
    expect(
      (await f.reader("alice").saved({ documentId: "doc" })).parts.length,
    ).toBeGreaterThan(0);
  } finally {
    f.client.close();
  }
});

test("corrupt historical narration exposure cannot be delivered or charged as a valid supplier contract", async () => {
  const f = await fixture();
  try {
    await f.grant("alice");
    const q = await f.caller("alice").quote({ documentId: "doc" });
    const op = await f.caller("alice").generate({
      documentId: "doc",
      idempotencyKey: "corrupt-contract",
      acceptedMaximum: q.maximum,
      acceptedRevision: q.revision,
      acceptedPeriod: q.periodId,
    });
    await f.client.execute({
      sql: "UPDATE pro_attempts SET exposure_nano_usd=1 WHERE operation_id=?",
      args: [required(op.id)],
    });
    await expect(
      f.reader("alice").saved({ documentId: "doc" }),
    ).rejects.toThrow("Supplier contract differs");
  } finally {
    f.client.close();
  }
});

for (const uncertain of [false, true]) {
  test(`narration dispatch rejection ${uncertain ? "holds uncertain synthesis" : "refunds before synthesis"} and prevents redispatch`, async () => {
    const f = await fixture();
    let dispatches = 0;
    const router = createNarrationRouter({
      ledger: () => f.ledger,
      executor: () => f.executor,
      source: async () => "pro",
      read: async () => "A calm reading.",
      dispatch: async (account, id) => {
        dispatches++;
        if (uncertain) {
          await f.ledger.claim(id);
          const plan = await f.ledger.narrationPlan(account, id);
          const chunk = plan.plan[0];
          if (!chunk) throw new Error("Missing quoted narration chunk");
          await f.ledger.startAttempt(id, chunk.hash);
        }
        throw new Error("Synthetic lost workflow response");
      },
    });
    const caller = router.createCaller({
      drizzle: db,
      schema: {},
      session: { user: { id: "alice" } },
      auth: { kind: "session" },
      headers: new Headers(),
    } as never);
    try {
      await f.grant("alice");
      const quote = await caller.quote({ documentId: "doc" });
      const request = {
        documentId: "doc",
        idempotencyKey: "dispatch-failure",
        acceptedMaximum: quote.maximum,
        acceptedRevision: quote.revision,
        acceptedPeriod: quote.periodId,
      };
      const result = await caller.generate(request);
      expect(result.state).toBe(uncertain ? "running" : "refunded");
      expect((await f.ledger.status("alice")).reservedSubcredits).toBe(
        uncertain ? quote.maximum : 0,
      );
      expect((await caller.generate(request)).id).toBe(result.id);
      expect(dispatches).toBe(1);
      expect(f.calls()).toBe(0);
    } finally {
      f.client.close();
    }
  });
}
