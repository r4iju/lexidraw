import { createClient, type Client } from "@libsql/client/sqlite3";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createFileMigrationOwner } from "../../../src/migrations/file-migration-owner.js";
import type { LegacyDocumentConversionBatch } from "../../../src/migrations/legacy-document-conversion.js";

export const evidence = tmpdir();
export const payload = await readFile(
  join(import.meta.dir, "../strict-document-conversion-v1/payload.json"),
  "utf8",
);
export const batch: LegacyDocumentConversionBatch = {
  sourceSetId: "modern-synthetic-v1",
  sourceIdentity: "modern-original0001-v1",
  provenance: "original0001:f741ca2490e7555f522fc4ea63fa1bffaf8af113",
  timestampProvenance: {
    unit: "unix-milliseconds",
    evidence:
      "Literal synthetic timestamps 1710000000001 through 1710000000003",
  },
  destination: "cached-modern-0036-v1",
  userIds: ["owner", "reader"],
};
export async function database() {
  const directory = await mkdtemp(join(evidence, "db-"));
  const url = pathToFileURL(join(directory, "synthetic.sqlite")).href;
  const client = createClient({ url });
  for (const file of [
    join(import.meta.dir, "../strict-document-conversion-v1/source.sql"),
    join(import.meta.dir, "destination.sql"),
    join(
      import.meta.dir,
      "../../../drizzle/0035_legacy_document_retention.sql",
    ),
    join(
      import.meta.dir,
      "../../../drizzle/0036_legacy_document_conversion_receipt.sql",
    ),
  ]) {
    for (const sql of (await readFile(file, "utf8")).split(
      "--> statement-breakpoint",
    ))
      if (sql.trim()) await client.execute(sql);
  }
  await client.execute("INSERT INTO User VALUES ('owner'),('reader')");
  await client.execute(
    "INSERT INTO Users (id,name,config,email,emailVerified,image,isActive,createdAt,updatedAt,deletedAt) VALUES ('owner','Owner',' {\"keep\":1.00} ','owner@example.invalid',7,'image-data',1,1710000000000,1710000000001,NULL),('reader','Reader',NULL,NULL,NULL,NULL,0,1710000000000,1710000000001,1710000000002)",
  );
  await client.execute({
    sql: "INSERT INTO Document VALUES ('conversion-doc-v1','Kept title',?,1710000000001,1710000000002,NULL,'owner','private')",
    args: [payload],
  });
  await client.execute(
    "INSERT INTO SharedDocument VALUES ('conversion-share-v1','conversion-doc-v1','reader','view',1710000000003)",
  );
  return {
    client,
    url,
    owner: createFileMigrationOwner(url),
    async close() {
      client.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export async function typed(client: Client, table: string) {
  const q = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const cols = (
    await client.execute(`PRAGMA table_xinfo(${q(table)})`)
  ).rows.map((r) => String(r.name));
  const selected = cols.flatMap((c, i) => [
    `typeof(${q(c)}) AS t${i}`,
    `hex(CAST(${q(c)} AS BLOB)) AS v${i}`,
  ]);
  return (
    await client.execute(
      `SELECT ${selected.join(",")} FROM ${q(table)} ORDER BY ${selected.map((_, i) => i + 1).join(",")}`,
    )
  ).rows.map((r) => ({ ...r }));
}
export async function state(client: Client) {
  const master = (
    await client.execute(
      "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name",
    )
  ).rows.map((r) => ({ ...r }));
  const rows: unknown[] = [];
  for (const t of master.filter(
    (r) => r.type === "table" && !String(r.name).startsWith("sqlite_"),
  ))
    rows.push([t.name, await typed(client, String(t.name))]);
  return { master, rows };
}
export async function immutable(client: Client) {
  const result: unknown[] = [];
  for (const t of [
    "User",
    "Users",
    "Document",
    "SharedDocument",
    "LegacyDocumentRetentionV1",
    "LegacyDocumentRetentionBatchV1",
    "LegacyDocumentConversionV1",
  ])
    result.push([t, await typed(client, t)]);
  return result;
}
