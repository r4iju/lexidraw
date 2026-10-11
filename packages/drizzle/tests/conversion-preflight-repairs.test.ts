import { expect, test } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createFileMigrationOwner } from "../src/migrations/file-migration-owner.js";
import { convertLegacyDocuments } from "../src/migrations/legacy-document-conversion.js";

const root =
  "/Users/emanuel/.ai/working/lexidraw-276-recovery/evidence/conversion-preflight-repairs-v1";
const fixture = join(import.meta.dir, "fixtures/strict-document-conversion-v1");
const cases: { name: string; sql: string }[] = JSON.parse(
  await readFile(
    join(
      import.meta.dir,
      "fixtures/conversion-preflight-repairs-v1/rejected-layouts.json",
    ),
    "utf8",
  ),
);

for (const scenario of cases) {
  test(`${scenario.name} STOP before live writes and rolls back capture`, async () => {
    const dir = await mkdtemp(join(root, "db-"));
    const url = pathToFileURL(join(dir, "synthetic.sqlite")).href;
    const client = createClient({ url });
    try {
      for (const sql of (
        await readFile(join(fixture, "source.sql"), "utf8")
      ).split("--> statement-breakpoint")) {
        if (sql.trim()) await client.execute(sql);
      }
      await client.executeMultiple(
        await readFile(join(fixture, "destination.sql"), "utf8"),
      );
      await client.executeMultiple(
        "INSERT INTO User VALUES ('owner'),('reader'); INSERT INTO Users VALUES ('owner'),('reader')",
      );
      const payload = await readFile(join(fixture, "payload.json"), "utf8");
      await client.execute({
        sql: "INSERT INTO Document VALUES ('doc','Title',?,1710000000001,1710000000002,NULL,'owner','private')",
        args: [payload],
      });
      await client.execute(
        "INSERT INTO SharedDocument VALUES ('share','doc','reader','view',1710000000003)",
      );
      await client.execute("PRAGMA foreign_keys=off");
      await client.executeMultiple(scenario.sql);
      const before = (
        await client.execute(
          "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name",
        )
      ).rows;
      const source = (await client.execute("SELECT * FROM Document")).rows;
      const shares = (await client.execute("SELECT * FROM SharedDocument"))
        .rows;
      let liveWrites = 0;
      await expect(
        createFileMigrationOwner(url).write((e) =>
          convertLegacyDocuments(
            {
              execute: async (statement) => {
                const sql =
                  typeof statement === "string" ? statement : statement.sql;
                if (
                  /^INSERT INTO (Entities|SharedEntities|LegacyDocumentConversionV1)\b/.test(
                    sql,
                  )
                )
                  liveWrites++;
                return e.execute(statement);
              },
              executeMultiple: e.executeMultiple,
            },
            {
              sourceSetId: "preflight-repair",
              sourceIdentity: "literal-preflight-repair",
              provenance:
                "original0001:f741ca2490e7555f522fc4ea63fa1bffaf8af113",
              timestampProvenance: {
                unit: "unix-milliseconds",
                evidence: "independent disposable fixture",
              },
              destination: "standalone-modern-v1",
              userIds: ["owner", "reader"],
            },
          ),
        ),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          message: expect.stringContaining("STOP"),
        }),
      });
      expect(liveWrites).toBe(0);
      expect(
        (
          await client.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name",
          )
        ).rows,
      ).toEqual(before);
      expect((await client.execute("SELECT * FROM Document")).rows).toEqual(
        source,
      );
      expect(
        (await client.execute("SELECT * FROM SharedDocument")).rows,
      ).toEqual(shares);
      expect((await client.execute("SELECT * FROM Entities")).rows).toEqual([]);
      expect(
        (await client.execute("SELECT * FROM SharedEntities")).rows,
      ).toEqual([]);
    } finally {
      client.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
