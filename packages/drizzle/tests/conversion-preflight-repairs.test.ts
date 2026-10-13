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
type Scenario = {
  name: string;
  sql: string;
  parent?: "User" | "Users";
  mismatchedCollation?: boolean;
};
const cases: Scenario[] = JSON.parse(
  await readFile(
    join(
      import.meta.dir,
      "fixtures/conversion-preflight-repairs-v1/rejected-layouts.json",
    ),
    "utf8",
  ),
);
const identityCases: Scenario[] = JSON.parse(
  await readFile(
    join(
      import.meta.dir,
      "fixtures/identity-collation-repair-v1/rejected-layouts.json",
    ),
    "utf8",
  ),
);

for (const scenario of [...cases, ...identityCases]) {
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
      if (scenario.mismatchedCollation) {
        const parent = scenario.parent;
        const child = parent === "User" ? "Document" : "Entities";
        expect(
          (await client.execute(`PRAGMA foreign_key_list(${child})`)).rows,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              table: parent,
              from: "userId",
              to: "id",
            }),
          ]),
        );
        expect(
          (await client.execute(`PRAGMA index_xinfo(${parent}_binary)`)).rows,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: "id",
              coll: "BINARY",
              desc: 0,
              key: 1,
            }),
          ]),
        );
        await client.execute("PRAGMA foreign_keys=on");
        await expect(
          client.execute(`UPDATE ${child} SET userId='owner'`),
        ).rejects.toThrow("foreign key mismatch");
        await client.execute("PRAGMA foreign_keys=off");
      }
      const before = (
        await client.execute(
          "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name",
        )
      ).rows;
      const source = (await client.execute("SELECT * FROM Document")).rows;
      const shares = (await client.execute("SELECT * FROM SharedDocument"))
        .rows;
      const state = async () => {
        const rows: unknown[] = [];
        for (const table of before.filter((r) => r.type === "table")) {
          const name = String(table.name).replaceAll('"', '""');
          rows.push([
            name,
            (await client.execute(`SELECT * FROM "${name}"`)).rows,
          ]);
        }
        return rows;
      };
      const allRows = await state();
      let liveWrites = 0;
      let mutations = 0;
      let outcome: unknown;
      let failure: unknown;
      try {
        outcome = await createFileMigrationOwner(url).write((e) =>
          convertLegacyDocuments(
            {
              execute: async (statement) => {
                const sql =
                  typeof statement === "string" ? statement : statement.sql;
                if (
                  /^(CREATE|INSERT|UPDATE|DELETE|DROP|ALTER)\b/.test(sql.trim())
                )
                  mutations++;
                if (
                  /^INSERT INTO (Entities|SharedEntities|LegacyDocumentConversionV1)\b/.test(
                    sql,
                  )
                )
                  liveWrites++;
                return e.execute(statement);
              },
              executeMultiple: async (sql) => {
                mutations++;
                return e.executeMultiple(sql);
              },
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
        );
      } catch (error) {
        failure = error;
      }
      if (scenario.parent) {
        console.info(
          JSON.stringify({
            scenario: scenario.name,
            setup: "complete",
            converterReached: true,
            outcome: outcome ?? null,
            liveWrites,
            mutations,
            receiptTable: (
              await client.execute(
                "SELECT COUNT(*) AS n FROM sqlite_master WHERE name='LegacyDocumentConversionV1'",
              )
            ).rows,
          }),
        );
      }
      expect(failure).toMatchObject({
        committed: false,
        cause: expect.objectContaining({
          message: expect.stringContaining(
            scenario.parent ? "STOP: unsupported identity parent DDL" : "STOP",
          ),
        }),
      });
      if (scenario.parent) expect(mutations).toBe(0);
      expect(liveWrites).toBe(0);
      expect(await state()).toEqual(allRows);
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
