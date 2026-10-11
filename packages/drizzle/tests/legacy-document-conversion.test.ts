import { expect, test } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createFileMigrationOwner,
  type MigrationExecutor,
} from "../src/migrations/file-migration-owner.js";
import {
  convertLegacyDocuments,
  type LegacyDocumentConversionBatch,
} from "../src/migrations/legacy-document-conversion.js";
import { captureLegacyDocuments } from "../src/migrations/legacy-document-retention.js";

const fixture = join(import.meta.dir, "fixtures/strict-document-conversion-v1");
const artifactRoot =
  "/Users/emanuel/.ai/working/lexidraw-276-recovery/evidence/strict-document-conversion-v1";
const payload = await readFile(join(fixture, "payload.json"), "utf8");
const expected = JSON.parse(
  await readFile(join(fixture, "expected.json"), "utf8"),
);
const batch: LegacyDocumentConversionBatch = {
  sourceSetId: "synthetic-conversion-1",
  sourceIdentity: "synthetic-original-1",
  provenance: "original0001:f741ca2490e7555f522fc4ea63fa1bffaf8af113",
  timestampProvenance: {
    unit: "unix-milliseconds",
    evidence: "independent synthetic fixture v1",
  },
  destination: "standalone-modern-v1",
  userIds: ["owner", "reader"],
};

async function database(empty = false) {
  const directory = await mkdtemp(join(artifactRoot, "db-"));
  const url = pathToFileURL(join(directory, "synthetic.sqlite")).href;
  const client = createClient({ url });
  for (const sql of (await readFile(join(fixture, "source.sql"), "utf8")).split(
    "--> statement-breakpoint",
  )) {
    if (sql.trim()) await client.execute(sql);
  }
  await client.executeMultiple(
    await readFile(join(fixture, "destination.sql"), "utf8"),
  );
  if (!empty) {
    await client.execute("INSERT INTO User VALUES ('owner'),('reader')");
    await client.execute("INSERT INTO Users VALUES ('owner'),('reader')");
    await client.execute({
      sql: "INSERT INTO Document VALUES ('conversion-doc-v1','Kept title',?,1710000000001,1710000000002,NULL,'owner','private')",
      args: [payload],
    });
    await client.execute(
      "INSERT INTO SharedDocument VALUES ('conversion-share-v1','conversion-doc-v1','reader','view',1710000000003)",
    );
    await client.execute(
      "INSERT INTO Drawing VALUES ('drawing-one','Kept drawing',' [{\"id\":\"shape\"}] ','{\"retain\":42}',1710000000004,1710000000005,1710000000006,'owner','private')",
    );
    await client.execute(
      "INSERT INTO SharedDrawing VALUES ('share-drawing','drawing-one','reader','edit',1710000000007)",
    );
  }
  return {
    client,
    owner: createFileMigrationOwner(url),
    async close() {
      client.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
type Db = Awaited<ReturnType<typeof database>>;

async function state(db: Db) {
  const master = (
    await db.client.execute(
      "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name",
    )
  ).rows;
  const rows: unknown[] = [];
  for (const table of master.filter(
    (r) => r.type === "table" && !String(r.name).startsWith("sqlite_"),
  )) {
    const info = (
      await db.client.execute(`PRAGMA table_xinfo("${table.name}")`)
    ).rows;
    const cols = info.flatMap((c, i) => [
      `typeof("${c.name}") AS t${i}`,
      `hex(CAST("${c.name}" AS BLOB)) AS v${i}`,
    ]);
    rows.push([
      table.name,
      (
        await db.client.execute(
          `SELECT ${cols.join(",")} FROM "${table.name}" ORDER BY 2`,
        )
      ).rows,
    ]);
  }
  return { master, rows };
}
const stop = {
  cause: expect.objectContaining({ message: expect.stringContaining("STOP") }),
};
async function rejected(
  db: Db,
  selected = batch,
  held?: (executor: MigrationExecutor) => MigrationExecutor,
) {
  const before = await state(db);
  await expect(
    db.owner.write((e) => convertLegacyDocuments(held ? held(e) : e, selected)),
  ).rejects.toMatchObject(stop);
  expect(await state(db)).toEqual(before);
}

// Every case below is authored and executed against the callable no-op before implementation.
test("copies exact parents then shares, preserves original bytes, records all derivations after verification", async () => {
  const db = await database();
  try {
    const drawings = (await db.client.execute("SELECT * FROM Drawing")).rows;
    const drawingShares = (
      await db.client.execute("SELECT * FROM SharedDrawing")
    ).rows;
    expect(
      await db.owner.write((e) => convertLegacyDocuments(e, batch)),
    ).toEqual({ documents: 1, shares: 1, repeated: false });
    expect((await db.client.execute("SELECT * FROM Entities")).rows).toEqual([
      expected.document,
    ]);
    expect(
      (await db.client.execute("SELECT * FROM SharedEntities")).rows,
    ).toEqual([expected.share]);
    expect((await db.client.execute("SELECT * FROM Drawing")).rows).toEqual(
      drawings,
    );
    expect(
      (await db.client.execute("SELECT * FROM SharedDrawing")).rows,
    ).toEqual(drawingShares);
    expect(
      (await db.client.execute("SELECT elements FROM Document")).rows[0]
        ?.elements,
    ).toBe(payload);
    const raw = (
      await db.client.execute(
        "SELECT sourceValues,status,mappedEntityId FROM LegacyDocumentRetentionV1 WHERE sourceTable='Document'",
      )
    ).rows[0];
    expect(
      JSON.parse(
        Buffer.from(raw?.sourceValues as ArrayBuffer).toString(),
      )[1][2],
    ).toEqual(["text", Buffer.from(payload).toString("hex")]);
    expect(raw?.status).toBe("retained");
    expect(raw?.mappedEntityId).toBeNull();
    const receipt = (
      await db.client.execute(
        "SELECT status,derivedFields FROM LegacyDocumentConversionV1",
      )
    ).rows[0];
    expect(receipt?.status).toBe("converted");
    expect(
      JSON.parse(Buffer.from(receipt?.derivedFields as ArrayBuffer).toString()),
    ).toEqual({
      version: 1,
      timestampProvenance: batch.timestampProvenance,
      userIds: ["owner", "reader"],
      documentDefaults: {
        entityType: "document",
        appState: null,
        parentId: null,
        screenShotLight: "",
        screenShotDark: "",
        isActive: 1,
        thumbnailStatus: "pending",
        thumbnailUpdatedAt: null,
        thumbnailVersion: null,
      },
      shareUpdatedAt: "createdAt",
      destination: "standalone-modern-v1",
    });
  } finally {
    await db.close();
  }
});

test("deleted dates and flags survive; exact root without audio is accepted without invented recording", async () => {
  const db = await database();
  try {
    const plain =
      '{"root":{"children":[{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"Literal plain","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"root","version":1}}';
    await db.client.execute({
      sql: "UPDATE Document SET elements=?,deletedAt=1710000000008,publicAccess='edit'",
      args: [plain],
    });
    await db.client.execute("UPDATE SharedDocument SET accessLevel='edit'");
    expect(
      await db.owner.write((e) => convertLegacyDocuments(e, batch)),
    ).toEqual({ documents: 1, shares: 1, repeated: false });
    expect(
      (
        await db.client.execute(
          "SELECT elements,deletedAt,publicAccess FROM Entities",
        )
      ).rows.map((r) => ({
        elements: r.elements,
        deletedAt: r.deletedAt,
        publicAccess: r.publicAccess,
      })),
    ).toEqual([
      { elements: plain, deletedAt: 1710000000008, publicAccess: "edit" },
    ]);
    expect(
      (
        await db.client.execute("SELECT accessLevel FROM SharedEntities")
      ).rows.map((r) => ({ accessLevel: r.accessLevel })),
    ).toEqual([{ accessLevel: "edit" }]);
  } finally {
    await db.close();
  }
});

test("zero source identities and rows is the narrowly explicit repeatable empty layout", async () => {
  const db = await database(true);
  try {
    expect(
      await db.owner.write((e) =>
        convertLegacyDocuments(e, { ...batch, userIds: [] }),
      ),
    ).toEqual({ documents: 0, shares: 0, repeated: false });
    const before = await state(db);
    expect(
      await db.owner.write((e) =>
        convertLegacyDocuments(e, { ...batch, userIds: [] }),
      ),
    ).toEqual({ documents: 0, shares: 0, repeated: true });
    expect(await state(db)).toEqual(before);
  } finally {
    await db.close();
  }
});

const corruptPayloads: [string, string][] = [
  ["corrupt JSON", "{"],
  ["trailing JSON", `${payload} null`],
  ["BOM", `\ufeff${payload}`],
  [
    "duplicate decoded top key",
    payload.replace('"unknown":', '"r\\u006fot":{},"unknown":'),
  ],
  [
    "duplicate unknown metadata key",
    payload.replace('"number":1.00', '"number":1.00,"n\\u0075mber":2'),
  ],
  [
    "duplicate nested node key",
    payload.replace('"detail":0', '"detail":0,"d\\u0065tail":0'),
  ],
  [
    "root v2",
    payload.replace('"type":"root","version":1', '"type":"root","version":2'),
  ],
  [
    "paragraph v2",
    payload.replace(
      '"type":"paragraph","version":1',
      '"type":"paragraph","version":2',
    ),
  ],
  [
    "text v2",
    payload.replace('"type":"text","version":1', '"type":"text","version":2'),
  ],
  ["missing node version", payload.replace(',"version":1', "")],
  ["unknown node", payload.replace('"type":"text"', '"type":"future-node"')],
  [
    "unknown root field",
    payload.replace('"type":"root"', '"future":42,"type":"root"'),
  ],
  [
    "unknown paragraph field",
    payload.replace('"type":"paragraph"', '"future":42,"type":"paragraph"'),
  ],
  [
    "unknown text field",
    payload.replace('"detail":0', '"future":42,"detail":0'),
  ],
  ["missing text field", payload.replace('"detail":0,', "")],
  [
    "empty root",
    '{"root":{"children":[],"direction":null,"format":"","indent":0,"type":"root","version":1}}',
  ],
  ["empty paragraph", payload.replace(/\{"detail":0.*?"version":1\}/, "")],
  ["empty text", payload.replace('"text":"Legacy hello"', '"text":""')],
  ["unknown text flag", payload.replace('"format":0', '"format":-1')],
  ["unknown text mode", payload.replace('"mode":"normal"', '"mode":"future"')],
  [
    "audio array",
    payload.replace(
      '"tts":{"text":"Legacy hello","audioUrl":"https://example.invalid/saved.mp3"}',
      '"tts":[]',
    ),
  ],
  [
    "unknown audio field",
    payload.replace('"audioUrl":', '"provider":"invented","audioUrl":'),
  ],
  [
    "missing audio metadata",
    payload.replace('"text":"Legacy hello","audioUrl":', '"audioUrl":'),
  ],
  ["empty audio URL", payload.replace("https://example.invalid/saved.mp3", "")],
];
for (const [name, value] of corruptPayloads) {
  test(`${name} STOP leaves complete synthetic database unchanged`, async () => {
    const db = await database();
    try {
      await db.client.execute({
        sql: "UPDATE Document SET elements=?",
        args: [value],
      });
      await rejected(db);
    } finally {
      await db.close();
    }
  });
}

const corruptRows: [string, string][] = [
  ["fatal UTF8 payload", "UPDATE Document SET elements=CAST(x'fffe' AS TEXT)"],
  ["fatal UTF8 title", "UPDATE Document SET title=CAST(x'ff' AS TEXT)"],
  ["BLOB payload", "UPDATE Document SET elements=x'7b7d'"],
  ["fractional date", "UPDATE Document SET updatedAt=1.5"],
  ["unrepresentable date", "UPDATE Document SET createdAt=8640000000000001"],
  ["unknown access flag", "UPDATE Document SET publicAccess='future'"],
  ["unknown share flag", "UPDATE SharedDocument SET accessLevel='future'"],
  ["dangling owner", "DELETE FROM Users WHERE id='owner'"],
  ["dangling source identity", "DELETE FROM User WHERE id='reader'"],
  [
    "dangling document reference",
    "UPDATE SharedDocument SET documentId='absent'",
  ],
  ["unknown source column", "ALTER TABLE Document ADD future TEXT"],
  ["unknown modern column", "ALTER TABLE Entities ADD future TEXT"],
  [
    "missing share unique constraint",
    "DROP INDEX SharedEntity_entityId_userId_key",
  ],
  [
    "unexpected destination trigger",
    "CREATE TRIGGER future AFTER INSERT ON Entities BEGIN UPDATE Entities SET title='lost'; END",
  ],
  ["document drawing collision", "UPDATE Drawing SET id='conversion-doc-v1'"],
  [
    "share drawing collision",
    "UPDATE SharedDrawing SET id='conversion-share-v1'",
  ],
  [
    "share drawing pair collision",
    "UPDATE SharedDrawing SET drawingId='conversion-doc-v1'",
  ],
  [
    "existing destination document",
    "INSERT INTO Entities (id,title,elements,entityType,createdAt,updatedAt,userId,publicAccess) VALUES ('conversion-doc-v1','Kept title','{}','document',1,2,'owner','private')",
  ],
  [
    "existing destination share id",
    "INSERT INTO SharedEntities VALUES ('conversion-share-v1','other','reader','view',1,1)",
  ],
  [
    "existing destination share pair",
    "INSERT INTO SharedEntities VALUES ('other-share','conversion-doc-v1','reader','view',1,1)",
  ],
  [
    "intermediate entity collision",
    "CREATE TABLE Entity (id TEXT); INSERT INTO Entity VALUES ('conversion-doc-v1')",
  ],
  [
    "intermediate share collision",
    "CREATE TABLE SharedEntity (id TEXT,entityId TEXT,userId TEXT); INSERT INTO SharedEntity VALUES ('conversion-share-v1','other','reader')",
  ],
];
for (const [name, sql] of corruptRows) {
  test(`${name} STOP before live modification`, async () => {
    const db = await database();
    try {
      await db.client.execute("PRAGMA foreign_keys=off");
      await db.client.executeMultiple(sql);
      await rejected(db);
    } finally {
      await db.close();
    }
  });
}
for (const [name, selected] of [
  [
    "missing timestamp evidence",
    {
      ...batch,
      timestampProvenance: { unit: "unix-milliseconds", evidence: "" },
    },
  ],
  [
    "wrong timestamp unit",
    {
      ...batch,
      timestampProvenance: { unit: "seconds", evidence: "not milliseconds" },
    },
  ],
  [
    "duplicate identity mapping",
    { ...batch, userIds: ["owner", "owner", "reader"] },
  ],
  ["missing identity mapping", { ...batch, userIds: ["owner"] }],
  ["unknown destination contract", { ...batch, destination: "other" }],
] as const) {
  test(`${name} STOP`, async () => {
    const db = await database();
    try {
      await rejected(db, selected as LegacyDocumentConversionBatch);
    } finally {
      await db.close();
    }
  });
}

test("exact receipt retry preserves later live edits and immutable raw capture", async () => {
  const db = await database();
  try {
    expect(
      await db.owner.write((e) => convertLegacyDocuments(e, batch)),
    ).toEqual({ documents: 1, shares: 1, repeated: false });
    await db.client.execute(
      "UPDATE Entities SET title='Later title',elements='{\"later\":true}',updatedAt=1710000000999",
    );
    await db.client.execute(
      "UPDATE SharedEntities SET accessLevel='edit',updatedAt=1710000000998",
    );
    const before = await state(db);
    expect(
      await db.owner.write((e) => convertLegacyDocuments(e, batch)),
    ).toEqual({ documents: 1, shares: 1, repeated: true });
    expect(await state(db)).toEqual(before);
    await rejected(db, {
      ...batch,
      timestampProvenance: {
        unit: "unix-milliseconds",
        evidence: "changed provenance",
      },
    });
    await rejected(db, { ...batch, sourceIdentity: "other-source" });
    await db.client.execute("UPDATE Document SET title='changed original'");
    await rejected(db);
  } finally {
    await db.close();
  }
});

test("damaged raw retention receipt is rejected before mapping", async () => {
  const db = await database();
  try {
    await db.owner.write((e) => captureLegacyDocuments(e, batch));
    await db.client.execute(
      "UPDATE LegacyDocumentRetentionV1 SET sourceValues=x'00'",
    );
    await rejected(db);
  } finally {
    await db.close();
  }
});

test("corrupt conversion receipt cannot certify or overwrite live rows", async () => {
  const db = await database();
  try {
    expect(
      await db.owner.write((e) => convertLegacyDocuments(e, batch)),
    ).toEqual({ documents: 1, shares: 1, repeated: false });
    await db.client.execute(
      "UPDATE LegacyDocumentConversionV1 SET destinationValues=x'00'",
    );
    await rejected(db);
  } finally {
    await db.close();
  }
});

for (const point of ["parent", "share", "verification", "receipt"] as const) {
  test(`failure at ${point} rolls back capture, live rows and conversion completion`, async () => {
    const db = await database();
    try {
      const before = await state(db);
      let parents = 0;
      const fault = (e: MigrationExecutor): MigrationExecutor => ({
        executeMultiple: e.executeMultiple,
        async execute(statement) {
          const sql = typeof statement === "string" ? statement : statement.sql;
          if (sql.startsWith("INSERT INTO Entities")) {
            parents++;
            if (point === "parent") throw new Error("injected parent failure");
          }
          if (sql.startsWith("INSERT INTO SharedEntities")) {
            expect(parents).toBe(1);
            if (point === "share") throw new Error("injected share failure");
          }
          if (
            point === "verification" &&
            parents &&
            sql.startsWith("SELECT") &&
            sql.includes("FROM Entities")
          ) {
            await e.execute("UPDATE Entities SET title='wrong mapped title'");
          }
          if (
            point === "receipt" &&
            sql.startsWith("INSERT INTO LegacyDocumentConversionV1")
          )
            throw new Error("injected receipt failure");
          return e.execute(statement);
        },
      });
      await expect(
        db.owner.write((e) => convertLegacyDocuments(fault(e), batch)),
      ).rejects.toBeDefined();
      expect(parents).toBe(1);
      expect(await state(db)).toEqual(before);
    } finally {
      await db.close();
    }
  });
}
