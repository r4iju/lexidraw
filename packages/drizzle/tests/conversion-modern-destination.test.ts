import { expect, test } from "bun:test";
import { convertLegacyDocuments } from "../src/migrations/legacy-document-conversion.js";
import { verifyCachedModernDestinationV1 } from "../src/migrations/cached-modern-destination-v1.js";
import {
  batch,
  database,
  payload,
  state,
  typed,
} from "./fixtures/conversion-modern-v1/database.js";

const unsupported = [
  ["parent column", "ALTER TABLE Users ADD COLUMN unknown TEXT"],
  [
    "parent default",
    "UPDATE sqlite_master SET sql=replace(sql,'DEFAULT 1','DEFAULT 2') WHERE name='Users'",
  ],
  [
    "declared parent NOCASE with BINARY key",
    "UPDATE sqlite_master SET sql=replace(sql,'`id` text','`id` text COLLATE NOCASE') WHERE name='Users'; CREATE UNIQUE INDEX binary_identity ON Users(id COLLATE BINARY)",
  ],
  [
    "declared parent RTRIM with BINARY key",
    "UPDATE sqlite_master SET sql=replace(sql,'`id` text','`id` text COLLATE RTRIM') WHERE name='Users'; CREATE UNIQUE INDEX binary_identity ON Users(id COLLATE BINARY)",
  ],
  ["parent index", "DROP INDEX User_email_key"],
  [
    "parent dependency",
    "CREATE TABLE UnknownParentChild (id TEXT, userId TEXT REFERENCES Users(id))",
  ],
  ["destination column", "ALTER TABLE Entities ADD COLUMN unknown TEXT"],
  [
    "historical parent FK",
    "UPDATE sqlite_master SET sql=replace(sql,'REFERENCES `Entities` (`id`) ON UPDATE cascade ON DELETE cascade','REFERENCES `Entities` (`id`) ON UPDATE no action ON DELETE no action') WHERE name='Entities'",
  ],
  [
    "destination default",
    "UPDATE sqlite_master SET sql=replace(sql,'''pending''','''ready''') WHERE name='Entities'",
  ],
  [
    "destination order",
    "UPDATE sqlite_master SET sql=replace(sql,'`title` text NOT NULL,\n  `elements` text NOT NULL','`elements` text NOT NULL,\n  `title` text NOT NULL') WHERE name='Entities'",
  ],
  [
    "destination index collation",
    "DROP INDEX Entity_title_idx; CREATE INDEX Entity_title_idx ON Entities(title COLLATE NOCASE)",
  ],
  [
    "destination partial index",
    "DROP INDEX Entity_unique_directory_name; CREATE UNIQUE INDEX Entity_unique_directory_name ON Entities(title,parentId) WHERE entityType='document'",
  ],
  ["missing Tags", "DROP TABLE Tags"],
  ["missing EntityTags", "DROP TABLE EntityTags"],
  ["tag column", "ALTER TABLE Tags ADD COLUMN unknown TEXT"],
  ["tag index", "DROP INDEX Tags_name_unique"],
  [
    "tag triple index",
    "DROP INDEX EntityTag_entityId_tagId_userId_key; CREATE UNIQUE INDEX EntityTag_entityId_tagId_userId_key ON EntityTags(entityId,tagId)",
  ],
  [
    "tag FK",
    "UPDATE sqlite_master SET sql=replace(sql,'REFERENCES `Tags` (`id`) ON UPDATE cascade ON DELETE cascade','REFERENCES `Tags` (`id`) ON UPDATE no action ON DELETE no action') WHERE name='EntityTags'",
  ],
  ["tag dependency", "CREATE VIEW UnknownTagView AS SELECT * FROM Tags"],
  [
    "destination trigger",
    "CREATE TRIGGER unknown_entity AFTER INSERT ON Entities BEGIN SELECT 1; END",
  ],
] as const;

// Each case exercises modern recognition first, then its rejected variant, through held transactions.
for (const [name, mutation] of unsupported)
  test(`recognizes cached modern baseline then rejects ${name} with zero writes`, async () => {
    const db = await database();
    try {
      await db.owner.write((e) => verifyCachedModernDestinationV1(e));
      await db.client.executeMultiple(
        `PRAGMA foreign_keys=off; PRAGMA writable_schema=on; ${mutation}; PRAGMA writable_schema=off; PRAGMA writable_schema=RESET;`,
      );
      const before = await state(db.client);
      let writes = 0;
      await expect(
        db.owner.write((e) =>
          convertLegacyDocuments(
            {
              execute: async (s) => {
                const sql = typeof s === "string" ? s : s.sql;
                if (/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(sql))
                  writes++;
                return e.execute(s);
              },
              executeMultiple: e.executeMultiple,
            },
            batch,
          ),
        ),
      ).rejects.toMatchObject({
        committed: false,
        cause: expect.objectContaining({
          message: expect.stringContaining("cached modern destination STOP"),
        }),
      });
      expect(writes).toBe(0);
      expect(await state(db.client)).toEqual(before);
    } finally {
      await db.close();
    }
  });

test("converts cached modern layout using canonical raw archives and 0036 receipt without changing Users data", async () => {
  const db = await database();
  try {
    const users = await typed(db.client, "Users");
    expect(
      await db.owner.write((e) => convertLegacyDocuments(e, batch)),
    ).toEqual({ documents: 1, shares: 1, repeated: false });
    expect(await typed(db.client, "Users")).toEqual(users);
    const row = (
      await db.client.execute(
        "SELECT * FROM Entities WHERE id='conversion-doc-v1'",
      )
    ).rows[0];
    expect(row as unknown).toEqual({
      id: "conversion-doc-v1",
      title: "Kept title",
      elements: payload,
      appState: null,
      entityType: "document",
      parentId: null,
      screenShotLight: "",
      screenShotDark: "",
      createdAt: 1710000000001,
      updatedAt: 1710000000002,
      deletedAt: null,
      userId: "owner",
      publicAccess: "private",
      isActive: 1,
      thumbnailStatus: "pending",
      thumbnailUpdatedAt: null,
      thumbnailVersion: null,
    });
    expect(
      (await db.client.execute("SELECT * FROM SharedEntities")).rows.map((r) =>
        Object.fromEntries(Object.entries(r)),
      ),
    ).toEqual([
      {
        id: "conversion-share-v1",
        entityId: "conversion-doc-v1",
        userId: "reader",
        accessLevel: "view",
        createdAt: 1710000000003,
        updatedAt: 1710000000003,
      },
    ]);
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
    expect((await db.client.execute("PRAGMA foreign_key_check")).rows).toEqual(
      [],
    );
  } finally {
    await db.close();
  }
});

for (const [name, sql, reason] of [
  [
    "document ID",
    "INSERT INTO Entities (id,title,elements,userId,publicAccess,createdAt,updatedAt) VALUES ('conversion-doc-v1','Other','[]','owner','private',1,2)",
    "document ID collision",
  ],
  [
    "share ID",
    "INSERT INTO SharedEntities VALUES ('conversion-share-v1','other','reader','view',1,2)",
    "share ID collision",
  ],
  [
    "share pair",
    "INSERT INTO SharedEntities VALUES ('other','conversion-doc-v1','reader','view',1,2)",
    "share pair collision",
  ],
] as const)
  test(`recognizes modern layout then rejects ${name} collision atomically`, async () => {
    const db = await database();
    try {
      await db.owner.write((e) => verifyCachedModernDestinationV1(e));
      await db.client.execute("PRAGMA foreign_keys=off");
      await db.client.execute(sql);
      const before = await state(db.client);
      let liveWrites = 0;
      await expect(
        db.owner.write((e) =>
          convertLegacyDocuments(
            {
              execute: async (s) => {
                if (
                  /^INSERT INTO (Entities|SharedEntities|LegacyDocumentConversionV1)/.test(
                    typeof s === "string" ? s : s.sql,
                  )
                )
                  liveWrites++;
                return e.execute(s);
              },
              executeMultiple: e.executeMultiple,
            },
            batch,
          ),
        ),
      ).rejects.toMatchObject({
        committed: false,
        cause: expect.objectContaining({
          message: expect.stringContaining(reason),
        }),
      });
      expect(liveWrites).toBe(0);
      expect(await state(db.client)).toEqual(before);
    } finally {
      await db.close();
    }
  });

test("recognizes modern layout then rolls back archive and inserted document on share failure", async () => {
  const db = await database();
  try {
    await db.owner.write((e) => verifyCachedModernDestinationV1(e));
    const before = await state(db.client);
    let inserted = 0;
    await expect(
      db.owner.write((e) =>
        convertLegacyDocuments(
          {
            execute: async (s) => {
              const sql = typeof s === "string" ? s : s.sql;
              if (sql.startsWith("INSERT INTO SharedEntities"))
                throw Error("synthetic share fault");
              if (sql.startsWith("INSERT INTO Entities")) inserted++;
              return e.execute(s);
            },
            executeMultiple: e.executeMultiple,
          },
          batch,
        ),
      ),
    ).rejects.toMatchObject({
      committed: false,
      cause: expect.objectContaining({ message: "synthetic share fault" }),
    });
    expect(inserted).toBe(1);
    expect(await state(db.client)).toEqual(before);
  } finally {
    await db.close();
  }
});

test("modern historical retry rejects changed receipts and mapping without changing live edits", async () => {
  const db = await database();
  try {
    await db.owner.write((e) => convertLegacyDocuments(e, batch));
    await db.client.execute(
      "UPDATE Entities SET title='Later edit',updatedAt=1710000000099",
    );
    for (const selected of [
      { ...batch, userIds: ["owner"] },
      {
        ...batch,
        timestampProvenance: {
          ...batch.timestampProvenance,
          evidence: "changed",
        },
      },
    ]) {
      const before = await state(db.client);
      await expect(
        db.owner.write((e) => convertLegacyDocuments(e, selected)),
      ).rejects.toMatchObject({ committed: false });
      expect(await state(db.client)).toEqual(before);
    }
    await db.client.execute(
      "UPDATE LegacyDocumentConversionV1 SET destinationValues=x'01'",
    );
    const before = await state(db.client);
    await expect(
      db.owner.write((e) => convertLegacyDocuments(e, batch)),
    ).rejects.toMatchObject({
      committed: false,
      cause: expect.objectContaining({
        message: expect.stringContaining("receipt mismatch"),
      }),
    });
    expect(await state(db.client)).toEqual(before);
  } finally {
    await db.close();
  }
});
