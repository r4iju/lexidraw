import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { assertTrackedMigrationBaseline } from "./migration-baseline.js";

async function fixture(sql: string[]) {
  const client = createClient({ url: "file::memory:" });
  for (const statement of sql) await client.execute(statement);
  return client;
}

test("ordinary migration rejects an existing schema with an empty journal", async () => {
  const client = await fixture([
    "CREATE TABLE Users(id TEXT PRIMARY KEY)",
    "CREATE TABLE __drizzle_migrations(hash TEXT, created_at INTEGER)",
  ]);
  try {
    await expect(assertTrackedMigrationBaseline(client)).rejects.toThrow(
      "untracked schema",
    );
  } finally {
    client.close();
  }
});

test("ordinary migration rejects AI tables ahead of the recorded journal", async () => {
  const client = await fixture([
    "CREATE TABLE pro_operations(id TEXT PRIMARY KEY)",
    "CREATE TABLE __drizzle_migrations(hash TEXT, created_at INTEGER)",
    "INSERT INTO __drizzle_migrations VALUES('baseline',1761866938152)",
  ]);
  try {
    await expect(assertTrackedMigrationBaseline(client)).rejects.toThrow(
      "ahead of the migration journal",
    );
  } finally {
    client.close();
  }
});

test("ordinary migration allows an empty database and a tracked AI schema", async () => {
  const empty = await fixture([]);
  const tracked = await fixture([
    "CREATE TABLE pro_operations(id TEXT PRIMARY KEY)",
    "CREATE TABLE __drizzle_migrations(hash TEXT, created_at INTEGER)",
    "INSERT INTO __drizzle_migrations VALUES('private_pro',1791623795854)",
  ]);
  try {
    await expect(
      assertTrackedMigrationBaseline(empty),
    ).resolves.toBeUndefined();
    await expect(
      assertTrackedMigrationBaseline(tracked),
    ).resolves.toBeUndefined();
  } finally {
    empty.close();
    tracked.close();
  }
});
