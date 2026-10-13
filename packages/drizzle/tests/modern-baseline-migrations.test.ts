import { expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import journal from "../drizzle/meta/_journal.json";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");
const fixture = resolve(import.meta.dir, "fixtures/e4-modern-0014");
const checkpoint = {
  hash: "78ab410710c6ad4e7969c31273fccb3e8f226c2fa8ad7ad94b7e20c0b7e6c54c",
  created_at: 1761866938152,
};
const documentElements =
  '{"blocks":[{"id":"paragraph-one","text":"Keep this unrelated content"}],"tts":{"id":"saved-audio","provider":"openai","voiceId":"nova","format":"mp3","segments":[{"index":0,"text":"Synthetic narration","audioUrl":"https://storage.test/tts/segment-0.mp3","sectionTitle":"Start","sectionIndex":0,"headingDepth":1,"sectionId":"section-one"}],"manifestUrl":"https://storage.test/tts/manifest.json","stitchedUrl":"https://storage.test/tts/stitched.mp3","updatedAt":"2025-10-30T12:34:56.789Z"},"futurePayload":{"retain":true}}';
const drawingElements =
  '[{"id":"shape-one","type":"rectangle","x":12,"y":34,"customData":{"retain":"literal"}}]';
const job = [
  "saved-audio",
  "document-one",
  "owner",
  "ready",
  "https://storage.test/tts/manifest.json",
  "https://storage.test/tts/stitched.mp3",
  1,
  null,
  '{"provider":"openai","voiceId":"nova","format":"mp3","future":{"retain":true}}',
  1761827696000,
  1761827696789,
  1,
  "run-synthetic",
];

async function insertJob(client: Client) {
  await client.execute({
    sql: "INSERT INTO TtsJobs (id,entityId,userId,status,manifestUrl,stitchedUrl,segmentCount,error,ttsConfig,createdAt,updatedAt,plannedCount,runId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    args: job,
  });
  expect(
    (await client.execute("SELECT * FROM TtsJobs")).rows.map((row) => [
      row.id,
      row.entityId,
      row.userId,
      row.status,
      row.manifestUrl,
      row.stitchedUrl,
      row.segmentCount,
      row.error,
      row.ttsConfig,
      row.createdAt,
      row.updatedAt,
      row.plannedCount,
      row.runId,
    ]),
  ).toEqual([job]);
}

async function content(client: Client) {
  return Promise.all(
    ["Users", "Entities", "SharedEntities"].map(
      async (table) =>
        (await client.execute(`SELECT * FROM ${table} ORDER BY id`)).rows,
    ),
  );
}
async function ledger(client: Client) {
  return (
    await client.execute(
      "SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at",
    )
  ).rows;
}
async function schema(client: Client) {
  return (
    await client.execute(
      "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name",
    )
  ).rows;
}
async function assertTtsShape(client: Client) {
  expect(
    (await client.execute("PRAGMA table_info(TtsJobs)")).rows.map((row) => [
      row.name,
      row.type,
      row.notnull,
      row.dflt_value,
      row.pk,
    ]),
  ).toEqual([
    ["id", "TEXT", 1, null, 1],
    ["entityId", "TEXT", 1, null, 0],
    ["userId", "TEXT", 1, null, 0],
    ["status", "TEXT", 1, null, 0],
    ["manifestUrl", "TEXT", 0, null, 0],
    ["stitchedUrl", "TEXT", 0, null, 0],
    ["segmentCount", "INTEGER", 0, null, 0],
    ["error", "TEXT", 0, null, 0],
    ["ttsConfig", "TEXT", 0, null, 0],
    ["createdAt", "INTEGER", 1, null, 0],
    ["updatedAt", "INTEGER", 1, null, 0],
    ["plannedCount", "INTEGER", 0, null, 0],
    ["runId", "TEXT", 0, null, 0],
  ]);
  expect(
    (await client.execute("PRAGMA foreign_key_list(TtsJobs)")).rows
      .map((row) => [row.table, row.from, row.to, row.on_update, row.on_delete])
      .sort(),
  ).toEqual([
    ["Entities", "entityId", "id", "CASCADE", "CASCADE"],
    ["Users", "userId", "id", "CASCADE", "CASCADE"],
  ]);
  for (const [name, column] of [
    ["TtsJobs_entityId_idx", "entityId"],
    ["TtsJobs_status_idx", "status"],
  ]) {
    expect(
      (await client.execute(`PRAGMA index_info(${name})`)).rows.map(
        (row) => row.name,
      ),
    ).toEqual([column]);
    expect(
      (await client.execute("PRAGMA index_list(TtsJobs)")).rows.find(
        (row) => row.name === name,
      )?.unique,
    ).toBe(0);
  }
  expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
}
async function modeledCheckpoint(
  name: "modern-0014-none" | "modern-0014-generic" | "modern-through-0027",
  run: (client: Client, dir: string) => Promise<void>,
) {
  const root =
    "/tmp/lexidraw-276-implementation/e4-migration-prerequisite-fixtures";
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "tts-"));
  const client = createClient({
    url: pathToFileURL(join(dir, `${name}.sqlite`)).href,
  });
  try {
    console.log(
      "synthetic local engine",
      (await client.execute("SELECT sqlite_version() AS version")).rows,
      "fixture",
      dir,
    );
    for (const sql of (
      await readFile(join(fixture, "schema.sql"), "utf8")
    ).split("--> statement-breakpoint"))
      if (sql.trim()) await client.execute(sql);
    await client.execute(
      "INSERT INTO Users (id,name,config,email,createdAt,updatedAt,deletedAt) VALUES ('owner','Synthetic owner','{\"retain\":true}','owner@example.test',1761800000000,1761800000123,NULL),('reader','Synthetic reader',NULL,'reader@example.test',1761800000001,1761800000456,1761800000789)",
    );
    await client.execute({
      sql: "INSERT INTO Entities (id,title,elements,appState,entityType,parentId,createdAt,updatedAt,deletedAt,userId,publicAccess,screenShotLight,screenShotDark) VALUES ('document-one','Synthetic document',?,NULL,'document',NULL,1761810000000,1761827696789,NULL,'owner','private','https://storage.test/light.png','https://storage.test/dark.png'),('drawing-one','Synthetic drawing',?,?,'drawing','document-one',1761810000123,1761810000456,1761810000789,'owner','view','','')",
      args: [
        documentElements,
        drawingElements,
        '{"viewBackgroundColor":"#ffffff","retain":42}',
      ],
    });
    await client.execute(
      "INSERT INTO SharedEntities (id,entityId,userId,accessLevel,createdAt,updatedAt) VALUES ('share-document','document-one','reader','view',1761811000000,1761811000123),('share-drawing','drawing-one','reader','edit',1761811000456,1761811000789)",
    );
    await client.execute(
      "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
    );
    await client.execute({
      sql: "INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)",
      args: [checkpoint.hash, checkpoint.created_at],
    });
    await run(client, dir);
  } finally {
    client.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("modern0014 upgrade supplies generic TtsJobs while preserving document drawing and saved audio", async () => {
  await modeledCheckpoint("modern-0014-none", async (client) => {
    const before = await content(client);
    expect(await ledger(client)).toEqual([checkpoint]);
    expect((await client.execute("PRAGMA table_info(TtsJobs)")).rows).toEqual(
      [],
    );
    await migrate(drizzle(client), { migrationsFolder });
    expect(await content(client)).toEqual(before);
    await insertJob(client);
    await assertTtsShape(client);
    const records = await ledger(client);
    expect(records[0]).toEqual(checkpoint);
    const repair = journal.entries.find(
      (entry) => entry.tag === "0034_tts_jobs_baseline",
    );
    expect(repair).toBeDefined();
    expect(
      records.filter((row) => row.created_at === repair?.when),
    ).toHaveLength(1);
    const afterSchema = await schema(client);
    await migrate(drizzle(client), { migrationsFolder });
    expect(await ledger(client)).toEqual(records);
    expect(await schema(client)).toEqual(afterSchema);
    expect(await content(client)).toEqual(before);
    expect(
      (await client.execute("SELECT * FROM TtsJobs")).rows.map((row) => [
        row.id,
        row.entityId,
        row.userId,
        row.status,
        row.manifestUrl,
        row.stitchedUrl,
        row.segmentCount,
        row.error,
        row.ttsConfig,
        row.createdAt,
        row.updatedAt,
        row.plannedCount,
        row.runId,
      ]),
    ).toEqual([job]);
  });
});

// This models the final extension shape; it does not replay the four original
// unjournaled files or claim their hashes as applied receipts.
const completeGenericTts = `CREATE TABLE TtsJobs (
 id text PRIMARY KEY NOT NULL, entityId text NOT NULL, userId text NOT NULL,
 status text NOT NULL, manifestUrl text, stitchedUrl text, segmentCount integer,
 error text, ttsConfig text, createdAt integer NOT NULL, updatedAt integer NOT NULL,
 plannedCount integer, runId text,
 FOREIGN KEY (entityId) REFERENCES Entities(id) ON UPDATE cascade ON DELETE cascade,
 FOREIGN KEY (userId) REFERENCES Users(id) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX TtsJobs_entityId_idx ON TtsJobs(entityId);
--> statement-breakpoint
CREATE INDEX TtsJobs_status_idx ON TtsJobs(status);`;

test("modern0014 complete generic jobs retain every field and gain the forward receipt once", async () => {
  await modeledCheckpoint("modern-0014-generic", async (client) => {
    for (const sql of completeGenericTts.split("--> statement-breakpoint"))
      await client.execute(sql);
    await insertJob(client);
    await assertTtsShape(client);
    const before = await content(client);
    const ttsSchema = (await schema(client)).filter(
      (row) => row.tbl_name === "TtsJobs",
    );
    expect(await ledger(client)).toEqual([checkpoint]);
    await migrate(drizzle(client), { migrationsFolder });
    expect(await content(client)).toEqual(before);
    expect(
      (await client.execute("SELECT * FROM TtsJobs")).rows.map((row) => [
        row.id,
        row.entityId,
        row.userId,
        row.status,
        row.manifestUrl,
        row.stitchedUrl,
        row.segmentCount,
        row.error,
        row.ttsConfig,
        row.createdAt,
        row.updatedAt,
        row.plannedCount,
        row.runId,
      ]),
    ).toEqual([job]);
    expect(
      (await schema(client)).filter((row) => row.tbl_name === "TtsJobs"),
    ).toEqual(ttsSchema);
    const records = await ledger(client);
    expect(records[0]).toEqual(checkpoint);
    expect(
      records.filter((row) => row.created_at === 1791698049490),
    ).toHaveLength(1);
    const afterSchema = await schema(client);
    await migrate(drizzle(client), { migrationsFolder });
    expect(await ledger(client)).toEqual(records);
    expect(await schema(client)).toEqual(afterSchema);
    expect(await content(client)).toEqual(before);
    expect(
      (await client.execute("SELECT * FROM TtsJobs")).rows.map((row) => [
        row.id,
        row.entityId,
        row.userId,
        row.status,
        row.manifestUrl,
        row.stitchedUrl,
        row.segmentCount,
        row.error,
        row.ttsConfig,
        row.createdAt,
        row.updatedAt,
        row.plannedCount,
        row.runId,
      ]),
    ).toEqual([job]);
  });
});

test("modern through0027 missing TtsJobs gains forward repair and inherited0032 without filling0028 hole", async () => {
  await modeledCheckpoint("modern-through-0027", async (client, dir) => {
    const through27 = join(dir, "through27");
    await mkdir(join(through27, "meta"), { recursive: true });
    const entries = journal.entries.filter((entry) => entry.idx <= 27);
    await writeFile(
      join(through27, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    for (const entry of entries)
      await copyFile(
        join(migrationsFolder, `${entry.tag}.sql`),
        join(through27, `${entry.tag}.sql`),
      );
    await migrate(drizzle(client), { migrationsFolder: through27 });
    const before = await content(client);
    const previousRecords = await ledger(client);
    expect(previousRecords[0]).toEqual(checkpoint);
    expect(previousRecords.at(-1)?.created_at).toBe(1791648000002);
    expect(
      previousRecords.some((row) => row.created_at === 1791647826278),
    ).toBe(false);
    expect((await client.execute("PRAGMA table_info(TtsJobs)")).rows).toEqual(
      [],
    );
    expect(
      (await client.execute("PRAGMA table_info(device_agent_edits)")).rows,
    ).toEqual([]);
    await migrate(drizzle(client), { migrationsFolder });
    expect(await content(client)).toEqual(before);
    await insertJob(client);
    await assertTtsShape(client);
    expect(
      (await client.execute("PRAGMA table_info(device_agent_edits)")).rows.map(
        (row) => [row.name, row.type, row.notnull, row.pk],
      ),
    ).toEqual([
      ["account_id", "TEXT", 1, 1],
      ["document_id", "TEXT", 1, 0],
      ["step_key", "TEXT", 1, 2],
      ["input_hash", "TEXT", 1, 0],
      ["receipt", "TEXT", 1, 0],
      ["created_at", "INTEGER", 1, 0],
    ]);
    const records = await ledger(client);
    expect(records.slice(0, previousRecords.length)).toEqual(previousRecords);
    expect(records.some((row) => row.created_at === 1791647826278)).toBe(false);
    expect(
      records.filter((row) => row.created_at === 1791685237782),
    ).toHaveLength(1);
    expect(
      records.filter((row) => row.created_at === 1791698049490),
    ).toHaveLength(1);
    const afterSchema = await schema(client);
    await migrate(drizzle(client), { migrationsFolder });
    expect(await ledger(client)).toEqual(records);
    expect(await schema(client)).toEqual(afterSchema);
    expect(await content(client)).toEqual(before);
    expect(
      (await client.execute("SELECT * FROM TtsJobs")).rows.map((row) => [
        row.id,
        row.entityId,
        row.userId,
        row.status,
        row.manifestUrl,
        row.stitchedUrl,
        row.segmentCount,
        row.error,
        row.ttsConfig,
        row.createdAt,
        row.updatedAt,
        row.plannedCount,
        row.runId,
      ]),
    ).toEqual([job]);
  });
});
