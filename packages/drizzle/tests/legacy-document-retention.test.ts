import { expect, test } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createFileMigrationOwner } from "../src/migrations/file-migration-owner.js";
import {
  captureLegacyDocuments,
  type OriginalDocumentBatch,
} from "../src/migrations/legacy-document-retention.js";

const fixture = join(import.meta.dir, "fixtures/e4-document-retention");
const batch: OriginalDocumentBatch = {
  sourceSetId: "synthetic-retention-batch-1",
  sourceIdentity: "synthetic-original-file-1",
  provenance: "original0001:f741ca2490e7555f522fc4ea63fa1bffaf8af113",
};

async function database() {
  const directory = await mkdtemp("/tmp/lexidraw-retention-");
  const url = pathToFileURL(join(directory, "original.sqlite")).href;
  const client = createClient({ url });
  const ddl = await readFile(join(fixture, "schema.sql"), "utf8");
  for (const sql of ddl.split("--> statement-breakpoint")) {
    if (sql.trim()) await client.execute(sql);
  }
  const rows = JSON.parse(await readFile(join(fixture, "rows.json"), "utf8"));
  for (const table of [
    "User",
    "Document",
    "Drawing",
    "SharedDocument",
    "SharedDrawing",
  ]) {
    for (const row of rows[table]) {
      await client.execute({
        sql: `INSERT INTO ${table} VALUES (${row.map(() => "?").join(",")})`,
        args: row,
      });
    }
  }
  await client.execute(await readFile(join(fixture, "binary.sql"), "utf8"));
  return { client, url, directory, ddl, owner: createFileMigrationOwner(url) };
}

async function originals(client: ReturnType<typeof createClient>) {
  return {
    schema: (
      await client.execute(
        "SELECT type,name,tbl_name,hex(CAST(sql AS BLOB)) AS ddl FROM sqlite_master WHERE tbl_name NOT LIKE 'LegacyDocumentRetention%' ORDER BY name",
      )
    ).rows,
    rows: (
      await client.execute(
        "SELECT hex(CAST(id AS BLOB)),hex(CAST(title AS BLOB)),typeof(elements),hex(CAST(elements AS BLOB)),CAST(createdAt AS TEXT),CAST(updatedAt AS TEXT),deletedAt,userId,publicAccess FROM Document ORDER BY CAST(id AS BLOB)",
      )
    ).rows,
    shares: (await client.execute("SELECT * FROM SharedDocument ORDER BY id"))
      .rows,
    drawings: (await client.execute("SELECT * FROM Drawing ORDER BY id")).rows,
    drawingShares: (
      await client.execute("SELECT * FROM SharedDrawing ORDER BY id")
    ).rows,
  };
}

async function archive(client: ReturnType<typeof createClient>) {
  return (
    await client.execute(
      "SELECT sourceSetId,sourceTable,hex(sourceId) AS id,typeof(sourceDDL) AS ddlType,sourceDDL,typeof(sourceColumns) AS columnsType,sourceColumns,typeof(sourceValues) AS valuesType,sourceValues,mappedEntityId,contractVersion,status,typeof(derivedFields) AS derivedType,derivedFields FROM LegacyDocumentRetentionV1 ORDER BY sourceTable,sourceId",
    )
  ).rows;
}

const utf8 = (value: unknown) =>
  Buffer.from(value as ArrayBuffer).toString("utf8");

test("capture durably retains every original row and literal bytes without changing originals", async () => {
  const db = await database();
  try {
    const before = await originals(db.client);
    const result = await db.owner.write((held) =>
      captureLegacyDocuments(held, batch),
    );
    expect(result).toEqual({ retainedRows: 3, repeated: false });
    db.client.close();
    const reopened = createClient({ url: db.url });
    try {
      expect(await originals(reopened)).toEqual(before);
      const rows = await archive(reopened);
      expect(rows).toHaveLength(3);
      expect(
        rows.map((r) => [
          r.sourceSetId,
          r.sourceTable,
          r.id,
          r.ddlType,
          r.columnsType,
          r.valuesType,
          r.mappedEntityId,
          r.contractVersion,
          r.status,
          r.derivedType,
        ]),
      ).toEqual([
        [
          batch.sourceSetId,
          "Document",
          "646F632D6F6E65",
          "blob",
          "blob",
          "blob",
          null,
          1,
          "retained",
          "blob",
        ],
        [
          batch.sourceSetId,
          "Document",
          "FF006964",
          "blob",
          "blob",
          "blob",
          null,
          1,
          "retained",
          "blob",
        ],
        [
          batch.sourceSetId,
          "SharedDocument",
          "73686172652D646F63",
          "blob",
          "blob",
          "blob",
          null,
          1,
          "retained",
          "blob",
        ],
      ]);
      const expected = JSON.parse(
        await readFile(join(fixture, "expected-values.json"), "utf8"),
      );
      expect(rows.map((r) => utf8(r.sourceValues))).toEqual([
        expected.Document[0],
        expected.binary,
        expected.SharedDocument[0],
      ]);
      for (const row of rows) {
        const originalDDL = db.ddl
          .split("--> statement-breakpoint")
          .find((s) =>
            s.trimStart().startsWith(`CREATE TABLE \`${row.sourceTable}\``),
          );
        if (!originalDDL)
          throw new Error("Missing independent original DDL oracle");
        expect(utf8(row.sourceDDL)).toBe(originalDDL.trim().replace(/;$/, ""));
        expect(utf8(row.derivedFields)).toBe(
          '[1,{"sourceIdentity":"synthetic-original-file-1","provenance":"original0001:f741ca2490e7555f522fc4ea63fa1bffaf8af113","mapping":null}]',
        );
      }
      expect(utf8(rows[0]?.sourceColumns)).toBe(
        '[1,[[0,"id","TEXT",1,null,1,0],[1,"title","TEXT",1,null,0,0],[2,"elements","TEXT",1,null,0,0],[3,"createdAt","INTEGER",1,null,0,0],[4,"updatedAt","INTEGER",1,null,0,0],[5,"deletedAt","INTEGER",0,null,0,0],[6,"userId","TEXT",1,null,0,0],[7,"publicAccess","TEXT",1,null,0,0]]]',
      );
      expect(utf8(rows[2]?.sourceColumns)).toBe(
        '[1,[[0,"id","TEXT",1,null,1,0],[1,"documentId","TEXT",1,null,0,0],[2,"userId","TEXT",1,null,0,0],[3,"accessLevel","TEXT",1,null,0,0],[4,"createdAt","INTEGER",1,null,0,0]]]',
      );
      expect(
        (
          await reopened.execute(
            "PRAGMA foreign_key_list(LegacyDocumentRetentionV1)",
          )
        ).rows,
      ).toEqual([]);
    } finally {
      reopened.close();
    }
  } finally {
    db.client.close();
    await rm(db.directory, { recursive: true, force: true });
  }
});

test("exact repeat reconciles the whole durable archive and source identity without overwriting", async () => {
  const db = await database();
  try {
    await db.owner.write((held) => captureLegacyDocuments(held, batch));
    const before = await archive(db.client);
    expect(
      await db.owner.write((held) => captureLegacyDocuments(held, batch)),
    ).toEqual({ retainedRows: 3, repeated: true });
    expect(await archive(db.client)).toEqual(before);
    for (const changed of [
      { ...batch, sourceIdentity: "other-original" },
      { ...batch, sourceSetId: "other-batch" },
    ]) {
      await expect(
        db.owner.write((held) => captureLegacyDocuments(held, changed)),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          message: expect.stringContaining("STOP"),
        }),
      });
      expect(await archive(db.client)).toEqual(before);
    }
    await db.client.execute(
      "UPDATE Document SET title='changed original' WHERE id='doc-one'",
    );
    const changedSource = await originals(db.client);
    await expect(
      db.owner.write((held) => captureLegacyDocuments(held, batch)),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("STOP"),
      }),
    });
    expect(await archive(db.client)).toEqual(before);
    expect(await originals(db.client)).toEqual(changedSource);
    await db.client.execute(
      "UPDATE Document SET title='Synthetic original document' WHERE id='doc-one'",
    );
    await db.client.execute(
      "UPDATE LegacyDocumentRetentionV1 SET sourceValues=x'00' WHERE sourceTable='Document' AND sourceId=x'646f632d6f6e65'",
    );
    const damaged = await archive(db.client);
    await expect(
      db.owner.write((held) => captureLegacyDocuments(held, batch)),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("STOP"),
      }),
    });
    expect(await archive(db.client)).toEqual(damaged);
  } finally {
    db.client.close();
    await rm(db.directory, { recursive: true, force: true });
  }
});
