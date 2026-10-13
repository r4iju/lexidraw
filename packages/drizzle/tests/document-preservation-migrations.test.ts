import { expect, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { migrate } from "../src/migrations/migrate.js";

const fixture = resolve(import.meta.dir, "fixtures/e4-original-document");
const migrationsFolder = resolve(import.meta.dir, "../drizzle");
const tables = [
  "User",
  "Document",
  "SharedDocument",
  "Drawing",
  "SharedDrawing",
];

async function schema(client: Client) {
  return (
    await client.execute(
      "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name",
    )
  ).rows;
}

async function originalState(client: Client) {
  return {
    schema: await schema(client),
    relations: await Promise.all(
      tables.map(async (table) => ({
        columns: (await client.execute(`PRAGMA table_xinfo(${table})`)).rows,
        foreignKeys: (await client.execute(`PRAGMA foreign_key_list(${table})`))
          .rows,
        indexes: (await client.execute(`PRAGMA index_list(${table})`)).rows,
      })),
    ),
    rows: await Promise.all(
      tables.map(async (table) =>
        (await client.execute(`SELECT * FROM ${table} ORDER BY id`)).rows.map(
          (row) => Object.values(row),
        ),
      ),
    ),
    bytes: await Promise.all(
      ["Document", "Drawing"].map(async (table) =>
        (
          await client.execute(
            `SELECT CAST(elements AS BLOB) AS elements${table === "Drawing" ? ", CAST(appState AS BLOB) AS appState" : ""} FROM ${table} ORDER BY id`,
          )
        ).rows.map((row) =>
          Object.values(row).map((value) =>
            value === null
              ? null
              : Buffer.from(value as ArrayBuffer).toString("hex"),
          ),
        ),
      ),
    ),
  };
}

test("original documents, drawings and shares survive a stopped pre0002 migration with no ledger", async () => {
  const directory = await mkdtemp("/tmp/lexidraw-document-preservation-");
  const client = createClient({
    url: pathToFileURL(join(directory, "original.sqlite")).href,
  });
  try {
    const ddl = await readFile(join(fixture, "schema.sql"), "utf8");
    for (const sql of ddl.split("--> statement-breakpoint")) {
      if (sql.trim()) await client.execute(sql);
    }
    const literals = JSON.parse(
      await readFile(join(fixture, "rows.json"), "utf8"),
    ) as Record<string, (string | number | null)[][]>;
    for (const table of tables) {
      for (const row of literals[table] ?? []) {
        await client.execute({
          sql: `INSERT INTO ${table} VALUES (${row.map(() => "?").join(",")})`,
          args: row,
        });
      }
    }
    const before = await originalState(client);
    expect(before.rows).toEqual(tables.map((table) => literals[table]));
    const expectedBytes = [
      (literals.Document ?? []).map((row) => [
        Buffer.from(String(row[2]), "utf8").toString("hex"),
      ]),
      (literals.Drawing ?? []).map((row) => [
        Buffer.from(String(row[2]), "utf8").toString("hex"),
        row[3] === null
          ? null
          : Buffer.from(String(row[3]), "utf8").toString("hex"),
      ]),
    ];
    expect(before.bytes).toEqual(expectedBytes);
    let failure: unknown;
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } catch (error) {
      failure = error;
    }
    // Inspect after catch even when a later historical statement rolled back.
    const after = await originalState(client);
    console.info("Original fixture migration outcome", {
      error: failure instanceof Error ? failure.message : String(failure),
      schemaUnchanged:
        JSON.stringify(after.schema) === JSON.stringify(before.schema),
      ledgerPresent: after.schema.some(
        (row) => row.name === "__drizzle_migrations",
      ),
      rowsUnchanged: JSON.stringify(after.rows) === JSON.stringify(before.rows),
    });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "Legacy Document/SharedDocument",
    );
    expect((failure as Error).message).toContain("Original data is retained");
    expect((failure as Error).message).toContain(
      "authoritative document conversion",
    );
    expect((failure as Error).message).toContain("0002_flippant_red_ghost");
    expect(after).toEqual(before);
    expect(after.bytes).toEqual(expectedBytes);
    expect(after.rows).toEqual(tables.map((table) => literals[table]));
    expect(
      after.schema.some((row) => row.name === "__drizzle_migrations"),
    ).toBe(false);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test.each([
  [
    "empty pair",
    "CREATE TABLE Document (id text); CREATE TABLE SharedDocument (id text);",
    false,
  ],
  [
    "partial case-insensitive table",
    "CREATE TABLE dOcUmEnT (unknown text);",
    true,
  ],
  [
    "unsupported view",
    "CREATE VIEW SHAREDDOCUMENT AS SELECT unavailable_function() AS unknown;",
    false,
  ],
])(
  "%s stops unchanged because atomic empty continuation is unavailable",
  async (_name, ddl, seededLedger) => {
    const directory = await mkdtemp("/tmp/lexidraw-document-preservation-");
    const client = createClient({
      url: pathToFileURL(join(directory, "unsupported.sqlite")).href,
    });
    try {
      for (const sql of String(ddl).split(";")) {
        if (sql.trim()) await client.execute(sql);
      }
      if (seededLedger) {
        await client.execute(
          "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
        );
        await client.execute({
          sql: "INSERT INTO __drizzle_migrations (id,hash,created_at) VALUES (?,?,?)",
          args: [7, "synthetic-existing-0002-receipt", 1710982131150],
        });
      }
      const before = await schema(client);
      let failure: unknown;
      try {
        await migrate(drizzle(client), { migrationsFolder });
      } catch (error) {
        failure = error;
      }
      const after = await schema(client);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(
        "Legacy Document/SharedDocument",
      );
      expect((failure as Error).message).toContain(
        "atomic empty continuation is unavailable",
      );
      expect(after).toEqual(before);
      if (seededLedger) {
        expect(
          (
            await client.execute(
              "SELECT id,hash,created_at FROM __drizzle_migrations",
            )
          ).rows.map((row) => Object.values(row)),
        ).toEqual([[7, "synthetic-existing-0002-receipt", 1710982131150]]);
      } else {
        expect(after.some((row) => row.name === "__drizzle_migrations")).toBe(
          false,
        );
      }
    } finally {
      client.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
