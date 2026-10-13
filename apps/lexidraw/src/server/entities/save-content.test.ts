/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import * as schema from "@packages/drizzle/drizzle-schema";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { InvalidDocumentPayloadError } from "~/lib/document-payload";
import {
  decodeSaveEntityContent,
  readEntityConflictContent,
  saveEntityContentColumns,
} from "./save-content";
import {
  drizzleDocumentStore,
  readDocumentMergeBase,
} from "../documents/document-store";

const CURRENT =
  ' {"root":{"children":[]}, "unknown":{"n":1.00,"snow":"\\u96ea"}} ';
const DDL = `CREATE TABLE Entities (
 id text PRIMARY KEY, title text NOT NULL, elements text NOT NULL, appState text,
 entityType text NOT NULL, parentId text, screenShotLight text DEFAULT '', screenShotDark text DEFAULT '',
 createdAt integer NOT NULL, updatedAt integer NOT NULL, deletedAt integer, userId text NOT NULL,
 publicAccess text NOT NULL, isActive integer DEFAULT 1, thumbnailStatus text DEFAULT 'pending',
 thumbnailUpdatedAt integer, thumbnailVersion text
)`;
async function setup(content: string, type = "document") {
  const client = createClient({ url: ":memory:" });
  await client.execute(DDL);
  await client.execute(
    "CREATE TABLE Tags (id text PRIMARY KEY, name text, createdAt integer, updatedAt integer)",
  );
  await client.execute(
    "CREATE TABLE EntityTags (entityId text, tagId text, userId text, createdAt integer, updatedAt integer)",
  );
  await client.execute("CREATE TABLE Writes (n integer)");
  await client.execute(
    "CREATE TRIGGER count_write AFTER UPDATE ON Entities BEGIN INSERT INTO Writes VALUES (1); END",
  );
  await client.execute({
    sql: "INSERT INTO Entities (id,title,elements,entityType,createdAt,updatedAt,userId,publicAccess) VALUES ('saved','Current',?,?,1,42,'synthetic','private')",
    args: [content, type],
  });
  const queries: string[] = [];
  const execute = client.execute.bind(client);
  // Reject unsafe TEXT at the driver boundary, never execute native corrupt TEXT.
  client.execute = async (
    statement: string | import("@libsql/client").InStatement,
  ) => {
    const query = typeof statement === "string" ? statement : statement.sql;
    queries.push(query);
    if (
      /^select/i.test(query) &&
      /"elements"/.test(query) &&
      !/CAST\(/i.test(query)
    )
      throw new Error("premature native TEXT");
    return execute(statement);
  };
  return { client, execute, queries, db: drizzle(client, { schema }) };
}

// These callers exercise the exact shared production projection selected by
// each save lookup; no router, transport or access decision is executed.
for (const route of ["entities.save", "documents.save"]) {
  for (const [kind, hex] of [
    ["invalid UTF8", "c328"],
    ["NUL suffix", Buffer.from(`${CURRENT}\0trailing`).toString("hex")],
    [
      "duplicate metadata key",
      Buffer.from('{"root":{"children":[]},"x":{"a":1,"\\u0061":2}}').toString(
        "hex",
      ),
    ],
    ["missing root", Buffer.from('{"tts":null}').toString("hex")],
  ] as const) {
    test(`${route} rejects ${kind} in its earlier projection without native TEXT or writes`, async () => {
      const { client, execute, queries, db } = await setup(CURRENT);
      try {
        await execute(
          `UPDATE Entities SET elements=CAST(X'${hex}' AS TEXT) WHERE id='saved'`,
        );
        await execute("DELETE FROM Writes");
        const project = async () => {
          const row = await db
            .select({
              entityType: schema.entities.entityType,
              ...saveEntityContentColumns,
            })
            .from(schema.entities)
            .where(eq(schema.entities.id, "saved"))
            .get();
          if (!row) throw new Error("missing fixture");
          return decodeSaveEntityContent(row);
        };
        await expect(project()).rejects.toBeInstanceOf(
          InvalidDocumentPayloadError,
        );
        expect(queries.length).toBe(1);
        expect(queries[0]).toMatch(/CAST\(.*elements.*AS BLOB\)/i);
        expect(queries[0]).toMatch(/typeof\(/i);
        expect(
          (await execute("SELECT count(*) AS n FROM Writes")).rows[0]?.n,
        ).toBe(0);
        expect(
          (
            await execute(
              "SELECT hex(CAST(elements AS BLOB)) AS raw FROM Entities",
            )
          ).rows[0]?.raw,
        ).toBe(hex.toUpperCase());
      } finally {
        client.close();
      }
    });
  }
  test(`${route} preserves exact earlier content then saves with current raw and revision CAS`, async () => {
    const { client, queries, db } = await setup(CURRENT);
    try {
      const row = await db
        .select({
          entityType: schema.entities.entityType,
          ...saveEntityContentColumns,
        })
        .from(schema.entities)
        .where(eq(schema.entities.id, "saved"))
        .get();
      if (!row) throw new Error("missing fixture");
      expect(decodeSaveEntityContent(row)).toBe(CURRENT);
      expect(queries[0]).toMatch(/CAST\(.*elements.*AS BLOB\)/i);
      // Validated current bytes permit the adapter's constrained TEXT check.
      const execute = client.execute.bind(client);
      client.execute = async (statement) => {
        const query = typeof statement === "string" ? statement : statement.sql;
        if (
          /^select/i.test(query) &&
          /"elements"/.test(query) &&
          !/CAST\(/i.test(query)
        ) {
          // Store's follow-up is itself constrained by the raw CAS predicate.
          throw new Error("unconstrained TEXT");
        }
        return execute(statement);
      };
      const base = await readDocumentMergeBase(db, "saved");
      expect(base?.text).toBe(CURRENT);
      const store = drizzleDocumentStore(db, "synthetic", undefined, {
        prepareRoot: async (x) => x,
      });
      expect(
        await store.write(
          "saved",
          { elements: '{"root":{"children":[{"type":"future"}]}}' },
          new Date(42),
        ),
      ).not.toBeNull();
      expect((await store.read("saved"))?.elements).toBe(
        ' {"root":{"children":[{"type":"future"}]}, "unknown":{"n":1.00,"snow":"\\u96ea"}} ',
      );
      expect(
        await store.write(
          "saved",
          { elements: '{"root":{"children":[]}}' },
          new Date(42),
        ),
      ).toBeNull();
    } finally {
      client.close();
    }
  });
}

for (const [type, content] of [
  ["drawing", '[{"id":"shape","x":12}]'],
  [
    "link",
    '{"url":"https://example.invalid/current","distilled":{"text":"Current"}}',
  ],
] as const) {
  test(`stale ${type} conflict returns current content, fields and revision`, async () => {
    const { client, execute, db } = await setup(content, type);
    try {
      // Generic reads retain native entity content semantics.
      client.execute = execute;
      const current = await readEntityConflictContent(
        db,
        "saved",
        "synthetic",
        type,
      );
      expect(current).toEqual({
        id: "saved",
        title: "Current",
        elements: content,
        appState: null,
        updatedAt: new Date(42),
        tags: [],
      });
      expect(
        (await execute("SELECT count(*) AS n FROM Writes")).rows[0]?.n,
      ).toBe(0);
    } finally {
      client.close();
    }
  });
}
