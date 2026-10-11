import { expect, test } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import type { Client } from "@libsql/client";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { runAtomicMigrations } from "../src/migrations/atomic-migrate";
import {
  createFileMigrationOwner,
  type MigrationExecutor,
  type MigrationOwner,
} from "../src/migrations/file-migration-owner";
import { convertLegacyDocuments } from "../src/migrations/legacy-document-conversion";
import expected from "./fixtures/atomic-document-continuation-v1/expected.json";

export const evidence =
  "/Users/emanuel/.ai/working/lexidraw-276-recovery/evidence/atomic-document-continuation-v1";
const fixture = join(
  import.meta.dir,
  "fixtures/atomic-document-continuation-v1",
);
export const folder = resolve(import.meta.dir, "../drizzle");
export const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export { expected };
export type State = {
  master: {
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
  }[];
  tables: Record<
    string,
    {
      columns: Record<string, unknown>[];
      foreignKeys: Record<string, unknown>[];
      indexes: (Record<string, unknown> & {
        keys: Record<string, unknown>[];
      })[];
      rows: Record<string, unknown>[];
    }
  >;
};
export async function snapshot(
  e: Pick<MigrationExecutor, "execute">,
): Promise<State> {
  const master = (
    await e.execute(
      "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name",
    )
  ).rows.map((r) => ({ ...r }));
  const tables: Record<string, unknown> = {};
  for (const t of master) {
    if (t.type !== "table") continue;
    const name = String(t.name);
    const columns = (
      await e.execute(`PRAGMA table_xinfo(${quote(name)})`)
    ).rows.map((r) => ({ ...r }));
    const expressions = columns.flatMap((c, i) => [
      `typeof(${quote(String(c.name))}) t${i}`,
      `hex(CAST(${quote(String(c.name))} AS BLOB)) v${i}`,
    ]);
    const indexes = [];
    for (const r of (await e.execute(`PRAGMA index_list(${quote(name)})`)).rows)
      indexes.push({
        ...r,
        keys: (
          await e.execute(`PRAGMA index_xinfo(${quote(String(r.name))})`)
        ).rows.map((r) => ({ ...r })),
      });
    tables[name] = {
      columns,
      foreignKeys: (
        await e.execute(`PRAGMA foreign_key_list(${quote(name)})`)
      ).rows.map((r) => ({ ...r })),
      indexes,
      rows: (
        await e.execute(
          `SELECT ${expressions.join(",")} FROM ${quote(name)} ORDER BY ${expressions.map((_, i) => i + 1).join(",")}`,
        )
      ).rows.map((r) => ({ ...r })),
    };
  }
  return { master, tables } as unknown as State;
}
export async function observe(url: string) {
  const c = createClient({ url });
  try {
    return await snapshot(c);
  } finally {
    c.close();
  }
}
export function profile(early = false, table = "__drizzle_migrations") {
  const baseline: State = clone(
    early ? expected.earlyBaseline : expected.baseline,
  );
  const final: State = clone(expected.final);
  if (!early && table !== "__drizzle_migrations") {
    for (const state of [baseline, final]) {
      const old = "__drizzle_migrations";
      for (const r of state.master) {
        if (r.name === old) {
          r.name = table;
          r.tbl_name = table;
          r.sql = `CREATE TABLE ${quote(table)} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`;
        }
        if (r.tbl_name === old) {
          r.tbl_name = table;
          r.name = `sqlite_autoindex_${table}_1`;
        }
      }
      state.master.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      const tables = state.tables as Record<string, unknown>;
      tables[table] = tables[old];
      delete tables[old];
      const t = tables[table] as { indexes: { name: string }[] };
      t.indexes[0]!.name = `sqlite_autoindex_${table}_1`;
    }
  }
  return {
    kind: early
      ? "synthetic-original0002-rollback-v1"
      : "synthetic-stranded-modern0014-v1",
    batch: clone(expected.batch),
    ledgerTable: table,
    baseline,
    completed: final,
    source: clone(expected.stage),
    journal: clone(early ? expected.journal.slice(0, 1) : expected.journal),
    pending: clone(early ? expected.journal.slice(0, 1) : expected.pending),
    maxSourceBytes: 1000000,
    maxSourceRows: 100,
  };
}
export type Profile = ReturnType<typeof profile>;
export type Result = { documents: number; shares: number; repeated: boolean };
export async function run(
  owner: MigrationOwner,
  config: { migrationsFolder: string; migrationsTable?: string },
  p: Profile,
): Promise<Result> {
  const modulePath = resolve(
    import.meta.dir,
    "../src/migrations/atomic-document-continuation.ts",
  );
  if (existsSync(modulePath)) {
    const implemented = await import(modulePath);
    return implemented.runAtomicDocumentContinuationV1(owner, config, p);
  }
  // Mechanical RED bridge: valid physical composition reaches the old public
  // converter's actual destination STOP, never a missing export/setup error.
  let result: Result | undefined;
  await runAtomicMigrations(owner, config, async (e) => {
    result = await convertLegacyDocuments(e, {
      ...p.batch,
      provenance: "original0001:f741ca2490e7555f522fc4ea63fa1bffaf8af113",
      destination: "cached-modern-0036-v1",
      timestampProvenance: {
        ...p.batch.timestampProvenance,
        unit: "unix-milliseconds",
      },
    });
  });
  if (!result) throw new Error("old callable did not compose conversion");
  return result;
}
export async function database(early = false, table = "__drizzle_migrations") {
  const dir = await mkdtemp(join(evidence, "db-"));
  const url = pathToFileURL(join(dir, "synthetic.sqlite")).href;
  const c = createClient({ url });
  const executeSQL = async (file: string) => {
    for (const s of (await readFile(file, "utf8")).split(
      "--> statement-breakpoint",
    ))
      if (s.trim()) await c.executeMultiple(s);
  };
  try {
    await c.execute("PRAGMA foreign_keys=off");
    await executeSQL(
      join(
        import.meta.dir,
        early
          ? "fixtures/e4-atomic/schema.sql"
          : "fixtures/e4-modern-0014/schema.sql",
      ),
    );
    if (!early) await executeSQL(join(fixture, "source.sql"));
    await c.execute("INSERT INTO User VALUES ('owner'),('reader')");
    await c.execute({
      sql: "INSERT INTO Document VALUES ('conversion-doc-v1','Kept title',?,1710000000001,1710000000002,NULL,'owner','private')",
      args: [expected.documents[0]!.elements],
    });
    await c.execute(
      "INSERT INTO SharedDocument VALUES ('conversion-share-v1','conversion-doc-v1','reader','view',1710000000003)",
    );
    if (early) {
      await c.execute(
        "INSERT INTO Drawing VALUES ('drawing-one','Drawing','[]',' {\"keep\":1.00} ',1710000000001,1710000000002,1710000000003,'owner','view')",
      );
      await c.execute(
        "INSERT INTO SharedDrawing VALUES ('drawing-share','drawing-one','reader','edit',1710000000003)",
      );
      await c.execute(
        "INSERT INTO WebRTCAnswer VALUES ('answer-one','drawing-one')",
      );
      await c.execute(
        "INSERT INTO WebRTCOffer VALUES ('offer-one','drawing-one')",
      );
    } else {
      await c.execute(
        "INSERT INTO Users (id,name,config,email,createdAt,updatedAt,deletedAt) VALUES ('owner','Synthetic owner',' {\"keep\":1.00} ','owner@example.invalid',1710000000000,1710000000001,NULL),('reader','Synthetic reader',NULL,'reader@example.invalid',1710000000000,1710000000001,1710000000002)",
      );
      await c.execute(
        "INSERT INTO Entities (id,title,elements,appState,entityType,parentId,createdAt,updatedAt,deletedAt,userId,publicAccess) VALUES ('drawing-one','Drawing','[]',' {\"keep\":1.00} ','drawing',NULL,1710000000001,1710000000002,1710000000003,'owner','view')",
      );
      await c.execute(
        "INSERT INTO SharedEntities VALUES ('drawing-share','drawing-one','reader','edit',1710000000003,1710000000003)",
      );
      await c.execute(
        "INSERT INTO Tags VALUES ('tag-one','Kept tag',1710000000001,1710000000002)",
      );
      await c.execute(
        "INSERT INTO EntityTags VALUES ('drawing-one','tag-one','owner',1710000000001,1710000000002)",
      );
      await c.execute(
        "INSERT INTO TtsJobs VALUES ('saved-audio','conversion-doc-v1','owner','ready','https://example.invalid/manifest','https://example.invalid/audio',1,NULL,' {\"keep\":1.00} ',1710000000001,1710000000002,1)",
      );
      await c.execute(
        `CREATE TABLE ${table === "__drizzle_migrations" ? table : quote(table)} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
      );
      await c.execute({
        sql: `INSERT INTO ${quote(table)} (hash,created_at) VALUES (?,?)`,
        args: [
          "78ab410710c6ad4e7969c31273fccb3e8f226c2fa8ad7ad94b7e20c0b7e6c54c",
          1761866938152,
        ],
      });
    }
    c.close();
    let migrationsFolder = folder;
    if (early) {
      migrationsFolder = join(dir, "migrations");
      const { mkdir, copyFile } = await import("node:fs/promises");
      await mkdir(join(migrationsFolder, "meta"), { recursive: true });
      await copyFile(
        join(import.meta.dir, "fixtures/e4-atomic/meta/_journal.json"),
        join(migrationsFolder, "meta/_journal.json"),
      );
      await copyFile(
        join(folder, "0002_flippant_red_ghost.sql"),
        join(migrationsFolder, "0002_flippant_red_ghost.sql"),
      );
    }
    expect(await observe(url)).toEqual(profile(early, table).baseline);
    return {
      url,
      config: { migrationsFolder, migrationsTable: table },
      owner: createFileMigrationOwner(url),
      p: profile(early, table),
      async close() {
        await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    c.close();
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
export async function control() {
  const db = await database();
  try {
    expect(await run(db.owner, db.config, db.p)).toEqual({
      documents: 1,
      shares: 1,
      repeated: false,
    });
    expect(await observe(db.url)).toEqual(expected.final);
  } finally {
    await db.close();
  }
}

const fault = new Error("injected witnessed continuation fault");
export function decorated(
  owner: MigrationOwner,
  after: (e: MigrationExecutor, sql: string) => Promise<void>,
  end?: (e: MigrationExecutor) => Promise<void>,
): MigrationOwner {
  return {
    write: (work) =>
      owner.write(async (held) => {
        const e: MigrationExecutor = {
          execute: async (s) => {
            const result = await held.execute(s);
            await after(held, typeof s === "string" ? s : s.sql);
            return result;
          },
          executeMultiple: async (s) => {
            await held.executeMultiple(s);
            await after(held, s);
          },
        };
        const value = await work(e);
        await end?.(held);
        return value;
      }),
  };
}

test("actual reader preserves all frozen bytes and nonmonotonic 0028; composition converts once", async () => {
  expect(readMigrationFiles({ migrationsFolder: folder })).toEqual(
    expected.journal.map((j) => ({
      sql: j.sql,
      bps: j.breakpoints,
      folderMillis: j.when,
      hash: j.hash,
    })),
  );
  await control();
});

const boundaries = [
  ["B1 staged before mutation", /^CREATE TABLE `pro_attempts`/],
  ["B3 real late table data boundary", /^CREATE TABLE `device_agent_edits`/],
  ["B4 TTS rename", /^ALTER TABLE TtsJobs RENAME COLUMN/],
  ["B4 TTS old index removed", /^DROP INDEX TtsJobs_documentId_idx/],
  ["B4 TTS index replacement", /^CREATE INDEX TtsJobs_entityId_idx/],
  ["B4 TTS nullable runId", /^ALTER TABLE TtsJobs ADD runId/],
  ["B5 first archive CREATE", /^CREATE TABLE LegacyDocumentRetentionV1/],
  ["B5 batch CREATE", /CREATE TABLE LegacyDocumentRetentionBatchV1/],
  ["B5 receipt CREATE", /^CREATE TABLE LegacyDocumentConversionV1/],
  ["B6 batch INSERT", /^INSERT INTO LegacyDocumentRetentionBatchV1/],
  ["B6 first raw INSERT", /^INSERT INTO LegacyDocumentRetentionV1/],
  ["B6 last raw INSERT", /^INSERT INTO LegacyDocumentRetentionV1/],
  ["B7 entity INSERT", /^INSERT INTO Entities/],
  ["B7 share INSERT", /^INSERT INTO SharedEntities/],
  [
    "B7 verification boundary",
    /^SELECT typeof\(id\) AS t0.*FROM Entities WHERE id=/,
  ],
  ["B8 receipt INSERT", /^INSERT INTO LegacyDocumentConversionV1/],
  [
    "B8 receipt readback",
    /^SELECT sourceSetId,sourceIdentity,contractVersion,status,typeof\(derivedFields\)/,
  ],
  ["B9 first ledger INSERT", /^INSERT INTO "__drizzle_migrations"/],
  ["B9 last ledger INSERT", /^INSERT INTO "__drizzle_migrations"/],
] as const;
for (const [name, pattern] of boundaries)
  test(`${name}: witnessed fault restores full literal baseline, retry then repeat`, async () => {
    await control();
    const db = await database();
    let seen = 0;
    let matches = 0;
    const target =
      name.includes("last raw") || name === "B8 receipt readback"
        ? 2
        : name.includes("last ledger")
          ? 15
          : 1;
    try {
      const owner = decorated(db.owner, async (e, s) => {
        if (pattern.test(s.trim()) && ++matches === target) {
          const state = await snapshot(e);
          if (name.startsWith("B1")) {
            expect(state.tables.Document.rows).toEqual(
              expected.baseline.tables.Document.rows,
            );
            expect(state.tables.SharedDocument.rows).toEqual(
              expected.baseline.tables.SharedDocument.rows,
            );
            expect(state.tables.User.rows).toEqual(
              expected.baseline.tables.User.rows,
            );
            expect(state.tables).not.toHaveProperty(
              "LegacyDocumentRetentionV1",
            );
          }
          if (name.startsWith("B4"))
            expect(
              (await e.execute("SELECT id,manifestUrl,ttsConfig FROM TtsJobs"))
                .rows[0],
            ).toMatchObject({
              id: "saved-audio",
              manifestUrl: "https://example.invalid/manifest",
              ttsConfig: ' {"keep":1.00} ',
            });
          if (name === "B8 receipt readback")
            expect(state.tables.LegacyDocumentConversionV1.rows).toEqual(
              expected.final.tables.LegacyDocumentConversionV1.rows,
            );
          seen++;
          throw fault;
        }
      });
      await expect(run(owner, db.config, db.p)).rejects.toMatchObject({
        committed: false,
        cause: fault,
      });
      expect(seen).toBe(1);
      expect(await observe(db.url)).toEqual(expected.baseline);
      expect(await run(db.owner, db.config, db.p)).toEqual({
        documents: 1,
        shares: 1,
        repeated: false,
      });
      expect(await observe(db.url)).toEqual(expected.final);
      let operations = 0;
      expect(
        await run(
          decorated(db.owner, async (_e, s) => {
            if (/^(INSERT|ALTER|CREATE|DROP|UPDATE|DELETE)/i.test(s.trim()))
              operations++;
          }),
          db.config,
          db.p,
        ),
      ).toEqual({ documents: 1, shares: 1, repeated: true });
      expect(operations).toBe(0);
      expect(await observe(db.url)).toEqual(expected.final);
    } finally {
      await db.close();
    }
  });

for (const [name, pattern] of [
  ["DROP Document", /^DROP TABLE `Document`/],
  ["DROP SharedDocument", /^DROP TABLE `SharedDocument`/],
  ["Drawing rename", /^ALTER TABLE `Drawing` RENAME/],
  ["SharedDrawing rename", /^ALTER TABLE `SharedDrawing` RENAME/],
  [
    "B3 actual shared column rename",
    /^ALTER TABLE `SharedEntity` RENAME COLUMN/,
  ],
] as const)
  test(`B2 early actual0002 ${name}: full schema, typed rows and absent ledger rollback only`, async () => {
    await control();
    const db = await database(true);
    let seen = 0;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const owner = decorated(db.owner, async (e, s) => {
          if (pattern.test(s.trim())) {
            const st = await snapshot(e);
            expect(st.tables).not.toHaveProperty("Document");
            if (name.includes("Drawing rename"))
              expect(st.tables.Entity.rows).toEqual(
                expected.earlyBaseline.tables.Drawing.rows,
              );
            if (name === "B3 actual shared column rename") {
              expect(st.tables.Entity.rows).toEqual(
                expected.earlyBaseline.tables.Drawing.rows,
              );
              expect(st.tables.SharedEntity.rows).toEqual(
                expected.earlyBaseline.tables.SharedDrawing.rows,
              );
            }
            expect(st.tables).not.toHaveProperty("LegacyDocumentRetentionV1");
            seen++;
            throw fault;
          }
        });
        await expect(run(owner, db.config, db.p)).rejects.toMatchObject({
          committed: false,
          cause: fault,
        });
        expect(seen).toBe(attempt + 1);
        expect(await observe(db.url)).toEqual(expected.earlyBaseline);
      }
    } finally {
      await db.close();
    }
  });

test("B10 all exact writes before commit roll back; completed archive repeat retains two edits after originals absent", async () => {
  await control();
  const db = await database();
  let seen = 0;
  try {
    await expect(
      run(
        decorated(
          db.owner,
          async () => {},
          async (e) => {
            expect(await snapshot(e)).toEqual(expected.final);
            seen++;
            throw fault;
          },
        ),
        db.config,
        db.p,
      ),
    ).rejects.toMatchObject({ committed: false, cause: fault });
    expect(seen).toBe(1);
    expect(await observe(db.url)).toEqual(expected.baseline);
    await run(db.owner, db.config, db.p);
    const c = createClient({ url: db.url });
    try {
      await c.execute("PRAGMA foreign_keys=off");
      await c.executeMultiple(
        "DROP TABLE SharedDocument; DROP TABLE Document; ALTER TABLE User RENAME TO ArchivedSyntheticUser",
      );
      await c.execute(
        "UPDATE Entities SET title='Edit one',updatedAt=1710000000010 WHERE id='conversion-doc-v1'",
      );
    } finally {
      c.close();
    }
    const edited = await observe(db.url);
    expect(await run(db.owner, db.config, db.p)).toEqual({
      documents: 1,
      shares: 1,
      repeated: true,
    });
    expect(await observe(db.url)).toEqual(edited);
    const c2 = createClient({ url: db.url });
    try {
      await c2.execute(
        "UPDATE Entities SET title='Edit two',elements='{}',updatedAt=1710000000020 WHERE id='conversion-doc-v1'",
      );
    } finally {
      c2.close();
    }
    const edited2 = await observe(db.url);
    await run(db.owner, db.config, db.p);
    expect(await observe(db.url)).toEqual(edited2);
  } finally {
    await db.close();
  }
});

for (const mode of [
  "corrupt mapped row",
  "reject receipt operation",
  "SQLite archive constraint abort",
  "SQLite ledger trigger abort",
] as const)
  test(`real composed ${mode} restores every literal byte`, async () => {
    await control();
    const db = await database();
    let seen = 0;
    try {
      const owner: MigrationOwner = {
        write: (work) =>
          db.owner.write(async (held) => {
            let count = 0;
            const wrapped: MigrationExecutor = {
              execute: async (s) => {
                const sql = typeof s === "string" ? s : s.sql;
                if (
                  mode === "reject receipt operation" &&
                  sql.startsWith("INSERT INTO LegacyDocumentConversionV1")
                ) {
                  seen++;
                  throw fault;
                }
                if (
                  mode === "SQLite archive constraint abort" &&
                  sql.startsWith("INSERT INTO LegacyDocumentRetentionV1") &&
                  ++count === 2
                ) {
                  seen++;
                  return held.execute({
                    sql: sql,
                    args:
                      typeof s === "string"
                        ? []
                        : [...(s.args as unknown[])].map((v, i) =>
                            i === 1 ? null : v,
                          ),
                  } as Parameters<MigrationExecutor["execute"]>[0]);
                }
                if (
                  mode === "SQLite ledger trigger abort" &&
                  /^INSERT INTO "__drizzle_migrations"/.test(sql)
                ) {
                  await held.execute(
                    "CREATE TRIGGER synthetic_ledger_abort BEFORE INSERT ON __drizzle_migrations BEGIN SELECT RAISE(ABORT,'injected ledger abort'); END",
                  );
                  seen++;
                }
                const result = await held.execute(s);
                if (
                  mode === "corrupt mapped row" &&
                  sql.startsWith("INSERT INTO SharedEntities")
                ) {
                  await held.execute(
                    "UPDATE Entities SET elements='{}' WHERE id='conversion-doc-v1'",
                  );
                  seen++;
                }
                return result;
              },
              executeMultiple: held.executeMultiple,
            };
            return work(wrapped);
          }),
      };
      await expect(run(owner, db.config, db.p)).rejects.toMatchObject({
        committed: false,
      });
      expect(seen).toBe(1);
      expect(await observe(db.url)).toEqual(expected.baseline);
      await run(db.owner, db.config, db.p);
      expect(await observe(db.url)).toEqual(expected.final);
    } finally {
      await db.close();
    }
  });

for (const reason of [
  "source DDL",
  "timestamp evidence",
  "duplicate mapping",
  "missing companion",
  "source bounds",
  "unknown legacy TTS",
] as const)
  test(`B0 ${reason} STOP before any mutation (valid control first)`, async () => {
    await control();
    const db = await database();
    let writes = 0;
    try {
      const p = clone(db.p);
      const c = createClient({ url: db.url });
      try {
        if (reason === "source DDL")
          await c.execute("ALTER TABLE Document ADD extra text");
        if (reason === "missing companion") await c.execute("DROP TABLE Tags");
        if (reason === "unknown legacy TTS")
          await c.execute("ALTER TABLE TtsJobs ADD runId text");
      } finally {
        c.close();
      }
      if (reason === "timestamp evidence")
        p.batch.timestampProvenance.evidence = "unbound evidence";
      if (reason === "duplicate mapping") p.batch.userIds.push("owner");
      if (reason === "source bounds") p.maxSourceBytes = 1;
      const before = await observe(db.url);
      await expect(
        run(
          decorated(db.owner, async (_e, s) => {
            if (/^(INSERT|CREATE|ALTER|DROP|UPDATE|DELETE)/i.test(s.trim()))
              writes++;
          }),
          db.config,
          p,
        ),
      ).rejects.toMatchObject({ committed: false });
      expect(writes).toBe(0);
      expect(await observe(db.url)).toEqual(before);
    } finally {
      await db.close();
    }
  });

test("owner settlement errors remain false/true/unknown without runner reinterpretation", async () => {
  await control();
  const { FileMigrationError } = await import(
    "../src/migrations/file-migration-owner"
  );
  for (const status of [false, true, "unknown"] as const) {
    const error = new FileMigrationError([new Error("owner outcome")], status);
    await expect(
      run(
        {
          write: async () => {
            throw error;
          },
        },
        { migrationsFolder: folder },
        profile(),
      ),
    ).rejects.toBe(error);
  }
  const db = await database();
  try {
    const owner = createFileMigrationOwner(db.url, {
      close() {
        throw fault;
      },
    });
    await expect(run(owner, db.config, db.p)).rejects.toMatchObject({
      committed: true,
    });
    expect(await observe(db.url)).toEqual(expected.final);
    await run(db.owner, db.config, db.p);
    expect(await observe(db.url)).toEqual(expected.final);
  } finally {
    await db.close();
  }
});

test("fixture setup prerequisites: literal early/default/custom identities before implementation", async () => {
  for (const [early, table] of [
    [true, "__drizzle_migrations"],
    [false, "__drizzle_migrations"],
    [false, 'custom " continuation'],
  ] as const) {
    const db = await database(early, table);
    await db.close();
  }
  for (const mode of ["absent", "generic"] as const) {
    const db = await database();
    const c = createClient({ url: db.url });
    try {
      if (mode === "absent") await c.execute("DROP TABLE TtsJobs");
      else
        await c.executeMultiple(
          "ALTER TABLE TtsJobs RENAME COLUMN documentId TO entityId;DROP INDEX TtsJobs_documentId_idx;CREATE INDEX TtsJobs_entityId_idx ON TtsJobs(entityId);ALTER TABLE TtsJobs ADD runId text",
        );
      expect(await snapshot(c)).toEqual(expected[`${mode}Baseline`]);
    } finally {
      c.close();
      await db.close();
    }
  }
});

test("B1 explicit staged typed bytes milestone before any journal mutation", async () => {
  await control();
  const db = await database();
  let seen = 0;
  let mutations = 0;
  try {
    const p = db.p as typeof db.p & {
      onStage?: (stage: string, source: unknown) => Promise<void>;
    };
    p.onStage = async (stage, source) => {
      if (stage === "staged") {
        expect(source).toEqual(expected.stage);
        seen++;
        throw fault;
      }
    };
    await expect(
      run(
        decorated(db.owner, async (_e, s) => {
          if (/^(INSERT|CREATE|ALTER|DROP|UPDATE|DELETE)/i.test(s.trim()))
            mutations++;
        }),
        db.config,
        p,
      ),
    ).rejects.toMatchObject({ committed: false, cause: fault });
    expect(seen).toBe(1);
    expect(mutations).toBe(0);
    expect(await observe(db.url)).toEqual(expected.baseline);
    delete p.onStage;
    await run(db.owner, db.config, p);
    expect(await observe(db.url)).toEqual(expected.final);
  } finally {
    await db.close();
  }
});

for (const mode of ["absent", "generic"] as const)
  test(`exact ${mode} TTS profile composes and repeats without normalization`, async () => {
    await control();
    const db = await database();
    let normalization = 0;
    try {
      const c = createClient({ url: db.url });
      try {
        if (mode === "absent") await c.execute("DROP TABLE TtsJobs");
        else
          await c.executeMultiple(
            "ALTER TABLE TtsJobs RENAME COLUMN documentId TO entityId;DROP INDEX TtsJobs_documentId_idx;CREATE INDEX TtsJobs_entityId_idx ON TtsJobs(entityId);ALTER TABLE TtsJobs ADD runId text",
          );
      } finally {
        c.close();
      }
      const p = db.p;
      p.baseline = clone(expected[`${mode}Baseline`]);
      p.completed = clone(expected[`${mode}Final`]);
      expect(await observe(db.url)).toEqual(p.baseline);
      await run(
        decorated(db.owner, async (_e, s) => {
          if (
            /^(ALTER TABLE TtsJobs|DROP INDEX TtsJobs|CREATE INDEX TtsJobs)/.test(
              s.trim(),
            )
          )
            normalization++;
        }),
        db.config,
        p,
      );
      expect(normalization).toBe(0);
      expect(await observe(db.url)).toEqual(p.completed);
      await run(db.owner, db.config, p);
      expect(await observe(db.url)).toEqual(p.completed);
    } finally {
      await db.close();
    }
  });

for (const mutation of [
  "sql bytes",
  "split order",
  "hash",
  "tag",
  "when",
  "version",
  "breakpoints",
  "actual selected idx",
  "duplicate actual entry",
] as const)
  test(`review repair early ${mutation} rejects before any mutation`, async () => {
    const db = await database(true);
    let mutations = 0;
    let splits = 0;
    let forwardedMutations = 0;
    try {
      const p = clone(db.p);
      const entry = p.pending[0];
      const actualEntry = p.journal[0];
      if (!entry || !actualEntry)
        throw new Error("literal early entry missing");
      if (mutation === "sql bytes")
        entry.sql.unshift(
          "UPDATE Document SET title='unapproved pending bytes'",
        );
      if (mutation === "split order") entry.sql.reverse();
      if (mutation === "hash") entry.hash = "unapproved hash";
      if (mutation === "tag") entry.tag = "unapproved tag";
      if (mutation === "when") entry.when++;
      if (mutation === "version") entry.version = "unapproved version";
      if (mutation === "breakpoints") entry.breakpoints = false;
      if (
        mutation === "actual selected idx" ||
        mutation === "duplicate actual entry"
      ) {
        const path = join(db.config.migrationsFolder, "meta/_journal.json");
        const journal = JSON.parse(await readFile(path, "utf8"));
        if (mutation === "actual selected idx") {
          journal.entries[0].idx = 3;
          actualEntry.idx = 3;
        } else {
          journal.entries.push(clone(journal.entries[0]));
          p.journal.push(clone(actualEntry));
        }
        await writeFile(path, JSON.stringify(journal));
      }
      let rejection: unknown;
      try {
        await run(
          {
            write: (work) =>
              db.owner.write((held) =>
                work({
                  execute: async (statement) => {
                    const sql =
                      typeof statement === "string" ? statement : statement.sql;
                    if (
                      /^(INSERT|CREATE|ALTER|DROP|UPDATE|DELETE)/i.test(
                        sql.trim(),
                      )
                    )
                      mutations++;
                    return held.execute(statement);
                  },
                  executeMultiple: async (sql) => {
                    splits++;
                    if (
                      /^(INSERT|CREATE|ALTER|DROP|UPDATE|DELETE)/i.test(
                        sql.trim(),
                      )
                    )
                      mutations++;
                    await held.executeMultiple(sql);
                    if (
                      /^(INSERT|CREATE|ALTER|DROP|UPDATE|DELETE)/i.test(
                        sql.trim(),
                      )
                    )
                      forwardedMutations++;
                    if (
                      sql ===
                      "UPDATE Document SET title='unapproved pending bytes'"
                    )
                      expect(
                        (
                          await held.execute(
                            "SELECT hex(CAST(title AS BLOB)) AS title FROM Document",
                          )
                        ).rows.map((row) => ({ title: row.title })),
                      ).toEqual([
                        {
                          title:
                            "756E617070726F7665642070656E64696E67206279746573",
                        },
                      ]);
                  },
                }),
              ),
          },
          db.config,
          p,
        );
      } catch (error) {
        rejection = error;
      }
      console.info(
        JSON.stringify({
          repair: mutation,
          mutations,
          forwardedMutations,
          splits,
          rejection: String(rejection),
        }),
      );
      expect(await observe(db.url)).toEqual(expected.earlyBaseline);
      expect(mutations).toBe(0);
      expect(forwardedMutations).toBe(0);
      expect(splits).toBe(0);
      expect(rejection).toMatchObject({ committed: false });
    } finally {
      await db.close();
    }
  });

test("review repair preexisting absentCreated generic TTS completes then fresh repeats with live edits", async () => {
  const oracle = JSON.parse(
    await readFile(join(fixture, "generic-absent-created.json"), "utf8"),
  ) as {
    baseline: State;
    completed: State;
  };
  const db = await database();
  let normalization = 0;
  try {
    const c = createClient({ url: db.url });
    try {
      await c.execute("PRAGMA foreign_keys=off");
      await c.executeMultiple(
        await readFile(join(fixture, "generic-absent-created.sql"), "utf8"),
      );
    } finally {
      c.close();
    }
    const p = db.p;
    p.baseline = clone(oracle.baseline);
    p.completed = clone(oracle.completed);
    expect(await observe(db.url)).toEqual(oracle.baseline);
    expect(
      await run(
        decorated(db.owner, async (_e, sql) => {
          if (
            /^(ALTER TABLE TtsJobs|DROP INDEX TtsJobs|CREATE INDEX TtsJobs)/.test(
              sql.trim(),
            )
          )
            normalization++;
        }),
        db.config,
        p,
      ),
    ).toEqual({ documents: 1, shares: 1, repeated: false });
    expect(normalization).toBe(0);
    expect(await observe(db.url)).toEqual(oracle.completed);
    console.info(
      "review repair absentCreated first run complete and literal full state equal",
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const editor = createClient({ url: db.url });
        try {
          await editor.execute(
            `UPDATE Entities SET title='Live edit ${attempt}' WHERE id='conversion-doc-v1'`,
          );
        } finally {
          editor.close();
        }
      }
      const edited = clone(oracle.completed);
      if (attempt > 0) {
        const row = edited.tables.Entities?.rows.find(
          (r) => r.v0 === "636F6E76657273696F6E2D646F632D7631",
        );
        if (!row) throw new Error("literal converted row missing");
        row.v1 = Buffer.from(`Live edit ${attempt}`)
          .toString("hex")
          .toUpperCase();
      }
      expect(await observe(db.url)).toEqual(edited);
      let writes = 0;
      let splits = 0;
      const fresh = createFileMigrationOwner(db.url);
      const owner: MigrationOwner = {
        write: (work) =>
          fresh.write((held) =>
            work({
              execute: async (statement) => {
                const sql =
                  typeof statement === "string" ? statement : statement.sql;
                if (
                  /^(INSERT|CREATE|ALTER|DROP|UPDATE|DELETE)/i.test(sql.trim())
                )
                  writes++;
                return held.execute(statement);
              },
              executeMultiple: async (sql) => {
                splits++;
                await held.executeMultiple(sql);
              },
            }),
          ),
      };
      expect(await run(owner, db.config, p)).toEqual({
        documents: 1,
        shares: 1,
        repeated: true,
      });
      expect(writes).toBe(0);
      expect(splits).toBe(0);
      expect(await observe(db.url)).toEqual(edited);
    }
  } finally {
    await db.close();
  }
});
