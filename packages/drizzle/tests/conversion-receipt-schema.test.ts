import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
  type DrizzleSQLiteSnapshotJSON,
} from "drizzle-kit/api";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planRetentionSafeMigration } from "../src/generation/retention-migration.js";
import contract from "../src/generation/retention-archive-contract.json" with {
  type: "json",
};
import physical from "./fixtures/conversion-receipt-v1/physical.json" with {
  type: "json",
};

const root = resolve(import.meta.dir, "..");
const name = "LegacyDocumentConversionV1";
const prior = JSON.parse(
  await readFile(join(root, "drizzle/meta/0035_snapshot.json"), "utf8"),
) as DrizzleSQLiteSnapshotJSON;
const ddl = (
  await readFile(
    join(import.meta.dir, "fixtures/conversion-receipt-v1/receipt.sql"),
    "utf8",
  )
)
  .trim()
  .slice(0, -1);
const archives = await readFile(
  join(root, "drizzle/0035_legacy_document_retention.sql"),
  "utf8",
);
function declaration() {
  const value = structuredClone(physical);
  value.uniqueConstraints = {} as typeof value.uniqueConstraints;
  return {
    ...value,
    indexes: {
      [`${name}_sourceIdentity_unique`]: {
        name: `${name}_sourceIdentity_unique`,
        columns: ["sourceIdentity"],
        isUnique: true,
      },
    },
  };
}
function pair() {
  return {
    previous: {
      ...prior,
      tables: { ...prior.tables, [name]: structuredClone(physical) },
    } as DrizzleSQLiteSnapshotJSON,
    current: {
      ...prior,
      tables: {
        ...prior.tables,
        ...structuredClone(contract.declarations),
        [name]: declaration(),
      },
    } as DrizzleSQLiteSnapshotJSON,
  };
}
function seeded() {
  const db = new Database(":memory:");
  db.exec(archives.replaceAll("--> statement-breakpoint", ""));
  db.exec(
    "CREATE TABLE Unrelated (id TEXT PRIMARY KEY, raw BLOB, count INTEGER); INSERT INTO Unrelated VALUES ('keep',x'00FF',9223372036854775807); CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC);",
  );
  const migrations = readMigrationFiles({
    migrationsFolder: join(root, "drizzle"),
  });
  for (const migration of migrations.filter(
    (m) => m.folderMillis <= 1791698049491,
  ))
    db.query(
      "INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)",
    ).run(migration.hash, migration.folderMillis);
  db.exec(
    "INSERT INTO LegacyDocumentRetentionV1 VALUES ('raw','Document',x'00',x'FF',x'01',x'02',NULL,1,'retained',x'03'); INSERT INTO LegacyDocumentRetentionBatchV1 VALUES ('raw','original','original0001',1,0);",
  );
  return db;
}
function state(db: Database) {
  return {
    master: db
      .query("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name")
      .all(),
    raw: db
      .query(
        "SELECT sourceSetId,sourceTable,hex(sourceId),hex(sourceDDL),hex(sourceColumns),hex(sourceValues),mappedEntityId,contractVersion,status,hex(derivedFields) FROM LegacyDocumentRetentionV1",
      )
      .all(),
    batch: db.query("SELECT * FROM LegacyDocumentRetentionBatchV1").all(),
    unrelated: db
      .query("SELECT id,hex(raw),CAST(count AS TEXT) FROM Unrelated")
      .all(),
    ledger: db
      .query("SELECT hash,created_at FROM __drizzle_migrations ORDER BY id")
      .all(),
  };
}
function applyNew(db: Database) {
  const migrations = readMigrationFiles({
    migrationsFolder: join(root, "drizzle"),
  });
  const pending = migrations.filter((m) => m.folderMillis > 1791698049491);
  db.transaction(() => {
    for (const m of pending) {
      for (const sql of m.sql) db.exec(sql);
      db.query(
        "INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)",
      ).run(m.hash, m.folderMillis);
    }
  })();
  return pending;
}

test("actual migration reader appends exact receipt without changing raw archives, unrelated values or prior receipt identities", async () => {
  const db = seeded();
  try {
    const before = state(db);
    const pending = applyNew(db);
    expect(
      db.query("SELECT sql FROM sqlite_master WHERE name=?").get(name),
    ).toEqual({ sql: ddl });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sql.map((s) => s.trim()).filter(Boolean)).toEqual([
      `${ddl};`,
    ]);
    const after = state(db);
    expect({
      ...after,
      master: after.master.filter(
        (r) => (r as { tbl_name: string }).tbl_name !== name,
      ),
      ledger: after.ledger.slice(0, -1),
    }).toEqual(before);
    expect(after.ledger.at(-1)).toEqual({
      hash: pending[0]?.hash,
      created_at: 1791698049492,
    });
    expect(db.query(`PRAGMA foreign_key_list(${name})`).all()).toEqual([]);
    expect(db.query(`PRAGMA table_info(${name})`).all()).toEqual([
      {
        cid: 0,
        name: "sourceSetId",
        type: "TEXT",
        notnull: 1,
        dflt_value: null,
        pk: 1,
      },
      {
        cid: 1,
        name: "sourceIdentity",
        type: "TEXT",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      },
      {
        cid: 2,
        name: "contractVersion",
        type: "INTEGER",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      },
      {
        cid: 3,
        name: "status",
        type: "TEXT",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      },
      {
        cid: 4,
        name: "derivedFields",
        type: "BLOB",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      },
      {
        cid: 5,
        name: "destinationValues",
        type: "BLOB",
        notnull: 1,
        dflt_value: null,
        pk: 0,
      },
    ]);
    expect(db.query(`PRAGMA index_list(${name})`).all()).toEqual([
      {
        seq: 0,
        name: `sqlite_autoindex_${name}_2`,
        unique: 1,
        origin: "u",
        partial: 0,
      },
      {
        seq: 1,
        name: `sqlite_autoindex_${name}_1`,
        unique: 1,
        origin: "pk",
        partial: 0,
      },
    ]);
    db.exec(
      `INSERT INTO ${name} VALUES ('receipt','identity',1,'converted',x'00FF',x'FE00');`,
    );
    expect(
      db
        .query(
          `SELECT typeof(derivedFields) AS dt,hex(derivedFields) AS d,typeof(destinationValues) AS vt,hex(destinationValues) AS v FROM ${name}`,
        )
        .get(),
    ).toEqual({ dt: "blob", d: "00FF", vt: "blob", v: "FE00" });
    for (const values of [
      "'other','identity',1,'converted',x'00',x'00'",
      "'receipt','other',1,'converted',x'00',x'00'",
      "'other','other',2,'converted',x'00',x'00'",
      "'other','other',1,'retained',x'00',x'00'",
    ])
      expect(() => db.exec(`INSERT INTO ${name} VALUES (${values})`)).toThrow();
    const journal = JSON.parse(
      await readFile(join(root, "drizzle/meta/_journal.json"), "utf8"),
    );
    expect(journal.entries.at(-1)).toEqual({
      idx: 36,
      version: "6",
      when: 1791698049492,
      tag: "0036_legacy_document_conversion_receipt",
      breakpoints: true,
    });
    const snapshot = JSON.parse(
      await readFile(join(root, "drizzle/meta/0036_snapshot.json"), "utf8"),
    );
    expect(snapshot.tables[name]).toEqual(physical);
    const { [name]: _receipt, ...rest } = snapshot.tables;
    expect(rest).toEqual(prior.tables);
    expect({
      ...snapshot,
      id: prior.id,
      prevId: prior.prevId,
      tables: rest,
    }).toEqual(prior);
    expect(snapshot.prevId).toBe(prior.id);
  } finally {
    db.close();
  }
});

test("receipt addition refuses preexisting receipts and rolls back every new statement and ledger entry", () => {
  const db = seeded();
  try {
    applyNew(db);
    expect(
      db.query("SELECT sql FROM sqlite_master WHERE name=?").get(name),
    ).toEqual({ sql: ddl });
    db.exec(
      `INSERT INTO ${name} VALUES ('original','identity',1,'converted',x'FF',x'00')`,
    );
    const before = state(db);
    expect(() => applyNew(db)).toThrow("already exists");
    expect(state(db)).toEqual(before);
    expect(
      db
        .query(
          `SELECT sourceSetId,sourceIdentity,hex(derivedFields) AS d,hex(destinationValues) AS v FROM ${name}`,
        )
        .all(),
    ).toEqual([
      { sourceSetId: "original", sourceIdentity: "identity", d: "FF", v: "00" },
    ]);
  } finally {
    db.close();
  }
});

test("offline public compiler validates the explicit canonical declaration against independent receipt metadata", async () => {
  const source = await readFile(join(root, "src/drizzle-schema.ts"), "utf8");
  const directory = await mkdtemp("/tmp/receipt-declarations-");
  try {
    const start = source.indexOf("export const legacyDocumentConversionV1");
    const end = source.indexOf("export type LegacyDocumentConversionV1", start);
    const file = join(directory, "schema.ts");
    await writeFile(
      file,
      `import { sql } from ${JSON.stringify(join(root, "node_modules/drizzle-orm/index.js"))};\nimport { blob, check, integer, sqliteTable, text, unique } from ${JSON.stringify(join(root, "node_modules/drizzle-orm/sqlite-core/index.js"))};\n${start === -1 ? "" : source.slice(start, end)}`,
    );
    const compiled = await generateSQLiteDrizzleJson(
      await import(pathToFileURL(file).href),
      prior.id,
    );
    expect(JSON.parse(JSON.stringify(compiled)).tables[name] ?? null).toEqual(
      declaration(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing synthetic mutation input");
  return value;
}

const mutations: [string, (s: DrizzleSQLiteSnapshotJSON) => void][] = [
  [
    "drop",
    (s) => {
      delete s.tables[name];
    },
  ],
  [
    "rename",
    (s) => {
      const t = required(s.tables[name]);
      delete s.tables[name];
      s.tables.RenamedReceipt = { ...t, name: "RenamedReceipt" };
    },
  ],
  [
    "alias",
    (s) => {
      s.tables.receiptAlias = { ...required(s.tables[name]), name };
    },
  ],
  [
    "type",
    (s) => {
      required(required(s.tables[name]).columns.destinationValues).type =
        "text";
    },
  ],
  [
    "version check",
    (s) => {
      required(
        required(s.tables[name]).checkConstraints[`${name}_contractVersion`],
      ).value = "contractVersion = 2";
    },
  ],
  [
    "status check",
    (s) => {
      required(
        required(s.tables[name]).checkConstraints[`${name}_status`],
      ).value = "status IN ('converted','retained')";
    },
  ],
  [
    "unique rename",
    (s) => {
      const t = required(s.tables[name]);
      t.indexes.renamed = {
        name: "renamed",
        columns: ["sourceIdentity"],
        isUnique: true,
      };
      delete t.indexes[`${name}_sourceIdentity_unique`];
    },
  ],
  [
    "unique removal",
    (s) => {
      required(s.tables[name]).indexes = {};
    },
  ],
  [
    "default",
    (s) => {
      required(required(s.tables[name]).columns.status).default = "'converted'";
    },
  ],
  [
    "cascading FK",
    (s) => {
      required(s.tables[name]).foreignKeys.receipt_fk = {
        name: "receipt_fk",
        tableFrom: name,
        tableTo: "LegacyDocumentRetentionBatchV1",
        columnsFrom: ["sourceSetId"],
        columnsTo: ["sourceSetId"],
        onDelete: "cascade",
        onUpdate: "cascade",
      };
    },
  ],
];
for (const [label, mutate] of mutations)
  test(`mandatory planner rejects proposed receipt ${label}`, async () => {
    const { previous, current } = pair();
    mutate(current);
    if (label === "rename")
      previous.tables.RenamedReceipt = structuredClone(
        required(current.tables.RenamedReceipt),
      );
    await expect(planRetentionSafeMigration(previous, current)).rejects.toThrow(
      "manual archive migration",
    );
  });

test("ordinary generation rejects a missing receipt baseline rather than auto-adopting it", async () => {
  const { current } = pair();
  await expect(planRetentionSafeMigration(prior, current)).rejects.toThrow(
    "manual archive migration",
  );
});

test("ordinary generation rejects modified physical receipt uniqueness", async () => {
  const { previous, current } = pair();
  required(previous.tables[name]).uniqueConstraints = {};
  await expect(planRetentionSafeMigration(previous, current)).rejects.toThrow(
    "manual archive migration",
  );
});

test("unchanged future generation excludes all three immutable tables and keeps unrelated additions", async () => {
  const { previous, current } = pair();
  const rawUnsafe = await generateSQLiteMigration(previous, current);
  expect(rawUnsafe.join("\n")).toContain(name);
  const noChange = await planRetentionSafeMigration(previous, current);
  expect(noChange.sql).toEqual([]);
  current.tables.FutureUnrelated = {
    name: "FutureUnrelated",
    columns: {
      value: {
        name: "value",
        type: "text",
        primaryKey: false,
        notNull: false,
        autoincrement: false,
      },
    },
    indexes: {},
    foreignKeys: {},
    compositePrimaryKeys: {},
    uniqueConstraints: {},
    checkConstraints: {},
  };
  const planned = await planRetentionSafeMigration(previous, current);
  expect(planned.sql).toEqual([
    "CREATE TABLE `FutureUnrelated` (\n\t`value` text\n);\n",
  ]);
  for (const immutable of [
    name,
    "LegacyDocumentRetentionV1",
    "LegacyDocumentRetentionBatchV1",
  ])
    expect(planned.snapshot.tables[immutable]).toEqual(
      previous.tables[immutable],
    );
  const db = seeded();
  try {
    db.exec(ddl);
    const before = state(db);
    db.exec(planned.sql.join("\n"));
    const after = state(db);
    expect({
      ...after,
      master: after.master.filter(
        (r) => (r as { tbl_name: string }).tbl_name !== "FutureUnrelated",
      ),
    }).toEqual(before);
    expect(
      await planRetentionSafeMigration(planned.snapshot, current),
    ).toMatchObject({ sql: [] });
  } finally {
    db.close();
  }
});
