import { test, expect, mock } from "bun:test";
import { createClient } from "@libsql/client";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { ProLedger } from "../pro/ledger";
mock.module("server-only", () => ({}));
const { DeviceAgentDocuments } = await import("./device-agent");
test("ordinary authenticated BYOK document edits require access, revision and allowlisted data, with atomic duplicate receipts and no Pro debit", async () => {
  const client = createClient({ url: ":memory:" });
  for (const sql of await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema as never),
  ))
    await client.execute(sql);
  const db = drizzle(client, { schema });
  await db
    .insert(schema.users)
    .values({ id: "alice", name: "Alice", email: "device@fixture.invalid" });
  await db
    .insert(schema.users)
    .values({ id: "bob", name: "Bob", email: "bob@fixture.invalid" });
  await db.insert(schema.entities).values({
    id: "doc",
    userId: "alice",
    title: "Fixture",
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
  const docs = new DeviceAgentDocuments(client, () => 1000);
  const input = {
    accountId: "alice",
    documentId: "doc",
    idempotencyKey: "one",
    revision: 1,
    edit: { kind: "append" as const, text: "Saved ordinary edit" },
  };
  await expect(docs.read("bob", "doc")).rejects.toThrow();
  await expect(docs.apply("bob", input)).rejects.toThrow();
  await expect(
    docs.apply("alice", { ...input, providerConfig: {} }),
  ).rejects.toThrow();
  const receipt = await docs.apply("alice", input);
  expect(await docs.apply("alice", input)).toEqual(receipt);
  expect((await docs.read("alice", "doc")).text).toBe("Saved ordinary edit");
  await expect(
    docs.apply("alice", { ...input, idempotencyKey: "two" }),
  ).rejects.toThrow("changed");
  await expect(
    docs.apply("alice", {
      ...input,
      edit: { kind: "append", text: "different" },
    }),
  ).rejects.toThrow("conflicts");
  expect(
    (
      await new ProLedger(client, {
        ownerAccountIds: [],
        now: () => 1000,
      }).status("alice")
    ).history,
  ).toHaveLength(0);
  await client.execute("UPDATE Entities SET userId='bob' WHERE id='doc'");
  await expect(docs.apply("alice", input)).rejects.toThrow();
  await expect(docs.apply("bob", input)).rejects.toThrow("Account scope");
  client.close();
});

test("a stale device action cannot mutate under a replacement authenticated account", async () => {
  const { DeviceMutation } = await import("~/lib/agent/device-core");
  expect(
    DeviceMutation.safeParse({
      documentId: "doc",
      revision: 1,
      idempotencyKey: "old",
      edit: { kind: "append", text: "Old account edit" },
    }).success,
  ).toBe(false);
});

test("synthetic image tool uses the existing bounded upload before an idempotent ordinary document mutation", async () => {
  const { createDeviceAgentImageUpload } = await import("./device-agent");
  const { GeneratedImages } = await import("./generated-images");
  const { fixtureImage } = await import("~/test/image-fixture");
  const client = createClient({ url: ":memory:" });
  for (const sql of await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema as never),
  ))
    await client.execute(sql);
  const db = drizzle(client, { schema });
  await db
    .insert(schema.users)
    .values({ id: "alice", name: "Alice", email: "image288@fixture.invalid" });
  await db.insert(schema.entities).values({
    id: "doc",
    userId: "alice",
    title: "Fixture",
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
  let uploads = 0;
  const images = new GeneratedImages(client, {
    now: () => 1000,
    canEdit: async () => true,
    store: {
      put: async () => {
        uploads++;
        return "https://fixture.invalid/bounded.png";
      },
      remove: async () => {},
    },
  });
  const docs = new DeviceAgentDocuments(
    client,
    () => 1000,
    createDeviceAgentImageUpload(images),
  );
  const input = {
    accountId: "alice",
    documentId: "doc",
    idempotencyKey: "image",
    revision: 1,
    edit: { kind: "image", image: fixtureImage() },
  };
  const receipt = await docs.apply("alice", input);
  expect(await docs.apply("alice", input)).toEqual(receipt);
  expect(uploads).toBe(1);
  expect(
    (await client.execute("SELECT elements FROM Entities WHERE id='doc'"))
      .rows[0]?.elements,
  ).toContain("/api/generated-images/");
  expect(
    (
      await new ProLedger(client, {
        ownerAccountIds: [],
        now: () => 1000,
      }).status("alice")
    ).history,
  ).toHaveLength(0);
  client.close();
});
