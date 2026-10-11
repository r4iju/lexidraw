import { AGENT_BOOK } from "~/lib/agent/contracts";
import { supplierFixture } from "~/test/supplier-fixture";
import { test, expect, mock } from "bun:test";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@packages/drizzle/drizzle-schema";
import { ProLedger } from "./ledger";
import { PublicAccess } from "@packages/types";
mock.module("server-only", () => ({}));
const { SqlAgentDocuments } = await import("./agent-documents");
test("production document adapter atomically saves an edit receipt with permission and revision checks; repeated step cannot append twice", async () => {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  for (const sql of await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema),
  ))
    await client.execute(sql);
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    agentBook: () => AGENT_BOOK,
    now: () => 1000,
  });
  await db
    .insert(schema.users)
    .values({ id: "alice", name: "Alice", email: "agent@test.invalid" });
  await db.insert(schema.entities).values({
    id: "doc",
    userId: "alice",
    title: "Test",
    entityType: "document",
    publicAccess: PublicAccess.PRIVATE,
    updatedAt: new Date(1),
    elements: JSON.stringify({
      root: {
        type: "root",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        children: [],
      },
    }),
  });
  let invalidations = 0;
  const docs = new SqlAgentDocuments(ledger, undefined, () => {
    invalidations++;
    if (invalidations === 1) throw new Error("Cache unavailable after commit");
  });
  await expect(docs.read("bob", "doc")).rejects.toThrow();
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
  const op = await ledger.reserve("alice", "one", "hash", "agent", {
    book: AGENT_BOOK,
    input: {
      documentId: "doc",
      revision: 1,
      prompt: "Add",
      idempotencyKey: "one",
      acceptedMaximum: 26629334,
    },
  });
  await ledger.claim(op.id);
  await expect(
    docs.apply("alice", "doc", `${op.id}:edit:0`, 1, {
      kind: "append",
      text: "Saved paragraph",
    }),
  ).rejects.toThrow("Cache unavailable after commit");
  const receipt = await docs.apply("alice", "doc", `${op.id}:edit:0`, 1, {
    kind: "append",
    text: "Saved paragraph",
  });
  expect(invalidations).toBe(2);
  expect(await docs.read("alice", "doc")).toMatchObject({
    text: "Saved paragraph",
    revision: receipt.revision,
  });
  expect(
    await docs.apply("alice", "doc", `${op.id}:edit:0`, 1, {
      kind: "append",
      text: "Saved paragraph",
    }),
  ).toEqual(receipt);
  await expect(
    docs.apply("alice", "doc", `${op.id}:edit:1`, 1, {
      kind: "append",
      text: "Clobber",
    }),
  ).rejects.toThrow("changed");
  await expect(
    docs.apply("alice", "doc", `${op.id}:edit:0`, 1, {
      kind: "append",
      text: "Different",
    }),
  ).rejects.toThrow("conflicts");
  await ledger.cancel("alice", op.id);
  await expect(
    docs.apply("alice", "doc", `${op.id}:edit:2`, receipt.revision, {
      kind: "append",
      text: "After cancel",
    }),
  ).rejects.toThrow();
  client.close();
});

test("a committed mutation receipt survives a losing executor's stale failure report", async () => {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  for (const sql of await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema),
  ))
    await client.execute(sql);
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    agentBook: () => AGENT_BOOK,
    now: () => 1000,
  });
  await db
    .insert(schema.users)
    .values({ id: "alice", name: "Alice", email: "receipt@fixture.invalid" });
  await db.insert(schema.entities).values({
    id: "doc",
    userId: "alice",
    title: "Test",
    entityType: "document",
    publicAccess: PublicAccess.PRIVATE,
    updatedAt: new Date(1),
    elements: JSON.stringify({
      root: {
        type: "root",
        version: 1,
        children: [],
        direction: null,
        format: "",
        indent: 0,
      },
    }),
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
  const op = await ledger.reserve("alice", "one", "hash", "agent", {
    book: AGENT_BOOK,
    input: {
      documentId: "doc",
      revision: 1,
      prompt: "Add saved paragraph",
      idempotencyKey: "one",
      acceptedMaximum: 26629334,
    },
  });
  await ledger.claim(op.id);
  const docs = new SqlAgentDocuments(ledger);
  await docs.apply("alice", "doc", `${op.id}:edit:0`, 1, {
    kind: "append",
    text: "Saved even after interruption",
  });
  await ledger.agentReport("alice", op.id, {
    status: "failed",
    completed: [],
    incomplete: ["Add saved paragraph"],
  });
  const report = (await ledger.agentJob("alice", op.id)).report;
  expect(report.completed.map((x) => x.description)).toEqual([
    "Saved even after interruption",
  ]);
  expect(report.incomplete).toEqual([]);
  client.close();
});
