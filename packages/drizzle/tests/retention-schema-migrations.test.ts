import { expect, test } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runAtomicMigrations } from "../src/migrations/atomic-migrate";
import { createFileMigrationOwner } from "../src/migrations/file-migration-owner";
import { captureLegacyDocuments } from "../src/migrations/legacy-document-retention";
import { checkpoint, seedRows } from "./fixtures/e4-retention-schema/modern-generic";
import priorLedger from "./fixtures/e4-retention-schema/prior-ledger.json";

const config = { migrationsFolder: resolve(import.meta.dir, "../drizzle") };
// Independent literal contract from the accepted capture module at 21a68d1.
const archiveDDL = [
  "CREATE TABLE LegacyDocumentRetentionV1 (sourceSetId TEXT NOT NULL, sourceTable TEXT NOT NULL, sourceId BLOB NOT NULL, sourceDDL BLOB NOT NULL, sourceColumns BLOB NOT NULL, sourceValues BLOB NOT NULL, mappedEntityId TEXT, contractVersion INTEGER NOT NULL CHECK(contractVersion = 1), status TEXT NOT NULL CHECK(status IN ('retained','converted')), derivedFields BLOB NOT NULL, PRIMARY KEY(sourceSetId,sourceTable,sourceId))",
  "CREATE TABLE LegacyDocumentRetentionBatchV1 (sourceSetId TEXT PRIMARY KEY NOT NULL, sourceIdentity TEXT NOT NULL UNIQUE, provenance TEXT NOT NULL, documentCount INTEGER NOT NULL, sharedDocumentCount INTEGER NOT NULL)",
];
const names = ["LegacyDocumentRetentionV1", "LegacyDocumentRetentionBatchV1"];
const contentTables = ["Users", "Entities", "SharedEntities", "TtsJobs"];
async function content(client: ReturnType<typeof createClient>) {
  return Promise.all(contentTables.map(async (table) =>
    (await client.execute(`SELECT * FROM ${table} ORDER BY id`)).rows));
}
async function ledger(client: ReturnType<typeof createClient>) {
  return (await client.execute("SELECT hash,created_at FROM __drizzle_migrations ORDER BY rowid")).rows.map((row) => ({ hash: row.hash, created_at: row.created_at }));
}
async function master(client: ReturnType<typeof createClient>) {
  return (await client.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name")).rows;
}

test("actual atomic journal preserves modern generic literals and receipts, creates capture-compatible archives and repeats", async () => {
  const directory = await mkdtemp("/tmp/lexidraw-retention-schema-");
  const url = pathToFileURL(join(directory, "modern-synthetic.sqlite")).href;
  const client = createClient({ url });
  const originalUrl = pathToFileURL(join(directory, "separate-original-synthetic.sqlite")).href;
  const original = createClient({ url: originalUrl });
  try {
    const schema = await readFile(join(import.meta.dir, "fixtures/e4-modern-0014/schema.sql"), "utf8");
    await client.executeMultiple(schema.replaceAll("--> statement-breakpoint", ""));
    await seedRows(client);
    const before = await content(client);
    expect(await ledger(client)).toEqual([checkpoint]);
    const owner = createFileMigrationOwner(url);
    const preflight = async (held: Parameters<Parameters<typeof owner.write>[0]>[0]) => {
      expect((await held.execute("SELECT name FROM sqlite_master WHERE lower(name) IN ('document','shareddocument')")).rows).toEqual([]);
    };
    await runAtomicMigrations(owner, config, preflight);
    expect(await content(client)).toEqual(before);
    expect((await ledger(client)).slice(0, 14)).toEqual([checkpoint, ...priorLedger]);
    console.log("modern actual journal applied; literal rows and prior 14 receipts preserved");
    const objects = await master(client);
    expect(names.map((name) => objects.find((row) => row.name === name)?.sql)).toEqual(archiveDDL);
    for (const [i, name] of names.entries()) {
      expect(objects.filter((row) => row.tbl_name === name).map((row) => [row.type, row.sql === null ? null : row.sql]))
        .toEqual(i === 0 ? [["table", archiveDDL[i]], ["index", null]] : [["table", archiveDDL[i]], ["index", null], ["index", null]]);
      expect((await client.execute(`PRAGMA foreign_key_list(${name})`)).rows).toEqual([]);
    }
    const migrations = readMigrationFiles(config);
    const retention = migrations.find((migration) => migration.folderMillis === 1791698049491)!;
    const conversion = migrations.find((migration) => migration.folderMillis === 1791698049492)!;
    expect(retention.folderMillis).toBe(1791698049491);
    expect(retention.sql).toHaveLength(2);
    expect(await ledger(client)).toEqual([
      checkpoint, ...priorLedger, { hash: retention.hash, created_at: 1791698049491 },
      { hash: conversion.hash, created_at: 1791698049492 },
    ]);
    const receipts = await ledger(client);
    await runAtomicMigrations(owner, config, preflight);
    expect(await ledger(client)).toEqual(receipts);
    expect(await master(client)).toEqual(objects);
    expect(await content(client)).toEqual(before);

    // Only the newly read additive migration runs on this separate original layout.
    // No historical original journal or destructive continuation is invoked.
    const fixture = join(import.meta.dir, "fixtures/e4-document-retention");
    for (const statement of (await readFile(join(fixture, "schema.sql"), "utf8")).split("--> statement-breakpoint"))
      if (statement.trim()) await original.execute(statement);
    const rows = JSON.parse(await readFile(join(fixture, "rows.json"), "utf8"));
    for (const table of ["User", "Document", "Drawing", "SharedDocument", "SharedDrawing"])
      for (const row of rows[table]) await original.execute({
        sql: `INSERT INTO ${table} VALUES (${row.map(() => "?").join(",")})`, args: row,
      });
    await original.execute(await readFile(join(fixture, "binary.sql"), "utf8"));
    const sourceRows = (await original.execute("SELECT hex(CAST(id AS BLOB)),hex(CAST(elements AS BLOB)) FROM Document ORDER BY CAST(id AS BLOB)")).rows;
    const originalOwner = createFileMigrationOwner(originalUrl);
    const batch = { sourceSetId: "synthetic-schema-batch", sourceIdentity: "synthetic-schema-original", provenance: "original0001:f741ca2490e7555f522fc4ea63fa1bffaf8af113" as const };
    await originalOwner.write(async (held) => {
      for (const statement of retention.sql) await held.executeMultiple(statement);
      expect(await captureLegacyDocuments(held, batch)).toEqual({ retainedRows: 3, repeated: false });
    });
    expect(await originalOwner.write((held) => captureLegacyDocuments(held, batch))).toEqual({ retainedRows: 3, repeated: true });
    expect((await original.execute("SELECT hex(CAST(id AS BLOB)),hex(CAST(elements AS BLOB)) FROM Document ORDER BY CAST(id AS BLOB)")).rows).toEqual(sourceRows);
    const expected = JSON.parse(await readFile(join(fixture, "expected-values.json"), "utf8"));
    expect((await original.execute("SELECT sourceValues FROM LegacyDocumentRetentionV1 ORDER BY sourceTable,sourceId")).rows.map((row) => Buffer.from(row.sourceValues as ArrayBuffer).toString("utf8")))
      .toEqual([expected.Document[0], expected.binary, expected.SharedDocument[0]]);
    console.log("separate original capture accepted migration-created archives; three literal rows retained and reconciled");
  } finally {
    client.close(); original.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
