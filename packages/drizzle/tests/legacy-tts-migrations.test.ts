import { expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "../src/migrations/migrate.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
  null,
];

async function insertJob(client: Client) {
  await client.execute({
    sql: "INSERT INTO TtsJobs (id,documentId,userId,status,manifestUrl,stitchedUrl,segmentCount,error,ttsConfig,createdAt,updatedAt,plannedCount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    args: job.slice(0, 12),
  });
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
  run: (client: Client, dir: string) => Promise<void>,
) {
  const dir = await mkdtemp("/tmp/lexidraw-276-legacy-tts-");
  const client = createClient({
    url: pathToFileURL(join(dir, "legacy.sqlite")).href,
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
    await client.executeMultiple(legacyDdl);
    await insertJob(client);
    await run(client, dir);
  } finally {
    client.close();
    await rm(dir, { recursive: true, force: true });
  }
}

// Literal committed unjournaled 0015/0016 DDL, not generated by the repair.
const legacyDdl =
  "CREATE TABLE IF NOT EXISTS `TtsJobs` (\n  `id` text PRIMARY KEY NOT NULL,\n  `documentId` text NOT NULL,\n  `userId` text NOT NULL,\n  `status` text NOT NULL,\n  `manifestUrl` text,\n  `stitchedUrl` text,\n  `segmentCount` integer,\n  `error` text,\n  `ttsConfig` text,\n  `createdAt` integer NOT NULL,\n  `updatedAt` integer NOT NULL,\n  FOREIGN KEY (`documentId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade,\n  FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade\n);\n\nCREATE INDEX IF NOT EXISTS `TtsJobs_documentId_idx` ON `TtsJobs` (`documentId`);\nCREATE INDEX IF NOT EXISTS `TtsJobs_status_idx` ON `TtsJobs` (`status`);\nALTER TABLE `TtsJobs` ADD COLUMN `plannedCount` integer;\n\n";

async function jobFields(client: Client) {
  return (
    await client.execute(
      "SELECT id,entityId,userId,status,manifestUrl,stitchedUrl,segmentCount,error,ttsConfig,createdAt,updatedAt,plannedCount,runId FROM TtsJobs ORDER BY id",
    )
  ).rows.map((row) => [
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
  ]);
}

test("known 0015+0016 legacy completed narration upgrades before0034 without losing content or receipts", async () => {
  await modeledCheckpoint(async (client) => {
    const before = await content(client);
    const prior = await ledger(client);
    expect(prior).toEqual([checkpoint]);
    expect(
      (await client.execute("PRAGMA table_info(TtsJobs)")).rows.map(
        (row) => row.name,
      ),
    ).toEqual([
      "id",
      "documentId",
      "userId",
      "status",
      "manifestUrl",
      "stitchedUrl",
      "segmentCount",
      "error",
      "ttsConfig",
      "createdAt",
      "updatedAt",
      "plannedCount",
    ]);
    await migrate(drizzle(client), { migrationsFolder });
    await assertTtsShape(client);
    expect(await content(client)).toEqual(before);
    expect(await jobFields(client)).toEqual([job]);
    expect(
      (await client.execute("PRAGMA index_list(TtsJobs)")).rows.some(
        (row) => row.name === "TtsJobs_documentId_idx",
      ),
    ).toBe(false);
    const records = await ledger(client);
    expect(records.slice(0, prior.length)).toEqual(prior);
    expect(
      records.filter((row) => row.created_at === 1791698049490),
    ).toHaveLength(1);
    expect(records.filter((row) => row.created_at === 1791647826278)).toEqual([
      {
        hash: "0de049078b996fdc83650850868aa2fb9cfa2466ca1040d9a77db430f4e9ebd0",
        created_at: 1791647826278,
      },
    ]);
    const afterSchema = await schema(client);
    await migrate(drizzle(client), { migrationsFolder });
    expect(await schema(client)).toEqual(afterSchema);
    expect(await ledger(client)).toEqual(records);
    expect(await content(client)).toEqual(before);
    expect(await jobFields(client)).toEqual([job]);
  });
});

// A quoted identifier can look identical after SQL whitespace normalization.
// Unexpected layouts must stop before changing schema, content or receipts.
test("unexpected quoted legacy columns stop atomically without guessed conversion", async () => {
  await modeledCheckpoint(async (client) => {
    await client.execute(
      'ALTER TABLE TtsJobs RENAME COLUMN userId TO "user Id"',
    );
    const beforeSchema = await schema(client);
    const beforeContent = await content(client);
    const beforeJobs = (await client.execute("SELECT * FROM TtsJobs")).rows;
    const beforeLedger = await ledger(client);
    await expect(
      migrate(drizzle(client), { migrationsFolder }),
    ).rejects.toThrow("Unsupported legacy TtsJobs schema; migration stopped");
    expect(await schema(client)).toEqual(beforeSchema);
    expect(await content(client)).toEqual(beforeContent);
    expect((await client.execute("SELECT * FROM TtsJobs")).rows).toEqual(
      beforeJobs,
    );
    expect(await ledger(client)).toEqual(beforeLedger);
  });
});
