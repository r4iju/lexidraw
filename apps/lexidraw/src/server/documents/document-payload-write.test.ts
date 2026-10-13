/// <reference types="bun" />
import { test, expect } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import * as schema from "@packages/drizzle/drizzle-schema";
import { drizzle } from "drizzle-orm/libsql";
import { createHeadlessEditor } from "@lexical/headless";
import { CORE_NODES } from "@packages/lexical-nodes/nodes";
import { $getRoot, $isTextNode } from "lexical";
import { readFileSync } from "node:fs";
import { drizzleDocumentStore } from "./document-store";

const CREATE_ENTITIES = `
  CREATE TABLE "Entities" (
    "id" text PRIMARY KEY NOT NULL,
    "title" text NOT NULL,
    "elements" text NOT NULL,
    "appState" text,
    "entityType" text NOT NULL DEFAULT 'drawing',
    "parentId" text,
    "screenShotLight" text NOT NULL DEFAULT '',
    "screenShotDark" text NOT NULL DEFAULT '',
    "createdAt" integer NOT NULL,
    "updatedAt" integer NOT NULL,
    "deletedAt" integer,
    "userId" text NOT NULL,
    "publicAccess" text NOT NULL,
    "isActive" integer NOT NULL DEFAULT 1,
    "thumbnailStatus" text DEFAULT 'pending',
    "thumbnailUpdatedAt" integer,
    "thumbnailVersion" text
  )
`;

const CREATE_TAGS = `
  CREATE TABLE "Tags" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL UNIQUE,
    "createdAt" integer NOT NULL,
    "updatedAt" integer NOT NULL
  )
`;

const CREATE_ENTITY_TAGS = `
  CREATE TABLE "EntityTags" (
    "entityId" text NOT NULL,
    "tagId" text NOT NULL,
    "userId" text NOT NULL,
    "createdAt" integer NOT NULL,
    "updatedAt" integer NOT NULL,
    PRIMARY KEY ("entityId", "tagId", "userId")
  )
`;

const fixture = (name: string) =>
  readFileSync(
    new URL(
      `../../lib/fixtures/document-payload-write-v1/${name}`,
      import.meta.url,
    ),
    "utf8",
  );
const AT = new Date("2026-10-01T00:00:00Z");
async function setup(elements = fixture("legacy-metadata.json")) {
  const client = createClient({ url: ":memory:" });
  for (const ddl of [CREATE_ENTITIES, CREATE_TAGS, CREATE_ENTITY_TAGS])
    await client.execute(ddl);
  const db = drizzle(client, { schema });
  await db.insert(schema.entities).values({
    id: "payload",
    title: "Synthetic",
    elements,
    entityType: "document",
    createdAt: AT,
    updatedAt: AT,
    userId: "synthetic",
    publicAccess: "private",
  });
  return { client, db };
}
const editor = () =>
  createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });

test("actual edited headless state saves and reopens with exact retained recording and metadata", async () => {
  const { client, db } = await setup();
  try {
    const store = drizzleDocumentStore(db, "synthetic", undefined, {
      prepareRoot: async (value) => value,
    });
    const revision = await store.read("payload");
    if (!revision) throw new Error("missing synthetic revision");
    const headless = editor();
    headless.setEditorState(headless.parseEditorState(revision.elements));
    headless.update(
      () => {
        const text = $getRoot().getAllTextNodes()[0];
        if (!$isTextNode(text)) throw new Error("missing text");
        text.setTextContent("Edited hello");
      },
      { discrete: true },
    );
    const incoming = JSON.stringify(headless.getEditorState());
    expect(Object.keys(JSON.parse(incoming))).toEqual(["root"]);
    expect(
      await store.write("payload", { elements: incoming }, revision.updatedAt),
    ).not.toBeNull();
    const reopened = await store.read("payload");
    if (!reopened) throw new Error("missing saved revision");
    const second = editor();
    second.setEditorState(second.parseEditorState(reopened.elements));
    expect(
      second.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("Edited hello");
    expect(reopened.elements).toContain(
      ',"tts":{"text":"Legacy hello","audioUrl":"https://example.invalid/saved.mp3"},"unknown":{"retain":"\\u2603","number":1.00}}\n',
    );
    expect(reopened.elements.startsWith('  {"root":')).toBe(true);
  } finally {
    client.close();
  }
});

test("current persisted metadata wins over incoming metadata even after root preparation", async () => {
  const { client, db } = await setup(
    ' {"unknown":{"n":2.00,"snow":"\\u96ea"}, "root" : {"children":[]}, "tts": {"audioUrl":"saved"}} ',
  );
  try {
    const store = drizzleDocumentStore(db, "synthetic", undefined, {
      prepareRoot: async (value) => JSON.stringify(JSON.parse(value)),
    });
    expect(
      await store.write(
        "payload",
        {
          elements:
            '{"root":{"children":[{"type":"future-modern","version":9}]},"tts":null,"unknown":{"n":0}}',
        },
        AT,
      ),
    ).not.toBeNull();
    expect((await store.read("payload"))?.elements).toBe(
      ' {"unknown":{"n":2.00,"snow":"\\u96ea"}, "root" : {"children":[{"type":"future-modern","version":9}]}, "tts": {"audioUrl":"saved"}} ',
    );
  } finally {
    client.close();
  }
});

test("metadata change with unchanged revision during preparation loses data CAS without stale replay", async () => {
  const { client, db } = await setup('{"root":{"children":[]},"unknown":1.00}');
  try {
    const store = drizzleDocumentStore(db, "synthetic", undefined, {
      prepareRoot: async (value) => {
        await client.execute({
          sql: "UPDATE Entities SET elements=? WHERE id='payload'",
          args: ['{"root":{"children":[]},"unknown":2.00}'],
        });
        return value;
      },
    });
    expect(
      await store.write(
        "payload",
        { elements: '{"root":{"children":[{"type":"new"}]}}' },
        AT,
      ),
    ).toBeNull();
    expect((await store.read("payload"))?.elements).toBe(
      '{"root":{"children":[]},"unknown":2.00}',
    );
  } finally {
    client.close();
  }
});

const corrupt = [
  "",
  '{"tts":null}',
  "[]",
  '{"root":[]}',
  '{"root":{}}',
  '{"root":{"children":[]},"root":{"children":[]}}',
  '{"root":{"children":[]},"\\u0072oot":{"children":[]}}',
  '{"root":{"children":[]},"unknown":[{"x":1,"\\u0078":2}]}',
  '{"root":{"children":[],"x":1,"x":2}}',
  '{"root":{"children":[]}} trailing',
  '{"root":{"children":[]},"n":01}',
  '{"root":{"children":[]},"n":1.}',
  '{"root":{"children":[]},"n":1e+}',
  '{"root":{"children":[]},"x":true,}',
  '{"root":{"children":[]},"x":[1,]}',
  '{"root":{"children":[]},"x":"\\q"}',
  '{"root":{"children":[]},"x":"\\u12g4"}',
  '\uFEFF{"root":{"children":[]}}',
  '{"root":{"children":[]}}\0',
  `{"root":{"children":[]},"x":${"[".repeat(257)}0${"]".repeat(257)}}`,
  `{"root":{"children":[]},"x":[${"0,".repeat(1_000_001)}0]}`,
];
for (const [index, current] of corrupt.entries()) {
  test(`corrupt current ${index} stops with zero payload writes`, async () => {
    const { client, db } = await setup(current);
    try {
      await client.execute("CREATE TABLE payload_writes (n INTEGER)");
      await client.execute(
        "CREATE TRIGGER count_payload_write AFTER UPDATE OF elements ON Entities BEGIN INSERT INTO payload_writes VALUES (1); END",
      );
      const store = drizzleDocumentStore(db, "synthetic", undefined, {
        prepareRoot: async (v) => v,
      });
      await expect(
        store.write("payload", { elements: '{"root":{"children":[]}}' }, AT),
      ).rejects.toThrow();
      expect(
        (await client.execute("SELECT count(*) AS n FROM payload_writes"))
          .rows[0]?.n,
      ).toBe(0);
      expect(
        (
          await client.execute(
            "SELECT hex(CAST(elements AS BLOB)) AS raw FROM Entities",
          )
        ).rows[0]?.raw,
      ).toBe(Buffer.from(current).toString("hex").toUpperCase());
    } finally {
      client.close();
    }
  });
}
for (const [index, current] of corrupt.entries()) {
  test(`invalid incoming ${index} stops with zero writes`, async () => {
    const { client, db } = await setup();
    try {
      const store = drizzleDocumentStore(db, "synthetic", undefined, {
        prepareRoot: async (v) => v,
      });
      await expect(
        store.write("payload", { elements: current }, AT),
      ).rejects.toThrow();
      expect(
        (await client.execute("SELECT elements,updatedAt FROM Entities"))
          .rows[0],
      ).toMatchObject({
        elements: fixture("legacy-metadata.json"),
        updatedAt: AT.getTime(),
      });
    } finally {
      client.close();
    }
  });
}
for (const expression of [
  "CAST(x'c328' AS TEXT)",
  "CAST(x'ff' AS TEXT)",
  "CAST(x'eda080' AS TEXT)",
  "x'7b7d'",
  "NULL",
]) {
  test(`unsafe storage ${expression} is rejected without reading native TEXT or writing`, async () => {
    const { client, db } = await setup();
    try {
      // NULL storage needs a separate permissive synthetic table.
      if (expression === "NULL") {
        await client.execute("DROP TABLE Entities");
        await client.execute(
          CREATE_ENTITIES.replace(
            '"elements" text NOT NULL',
            '"elements" text',
          ),
        );
        await client.execute({
          sql: "INSERT INTO Entities(id,title,elements,createdAt,updatedAt,userId,publicAccess) VALUES ('payload','Synthetic',NULL,?,?, 'synthetic','private')",
          args: [AT.getTime(), AT.getTime()],
        });
      } else await client.execute(`UPDATE Entities SET elements=${expression}`);
      const before = (
        await client.execute(
          "SELECT hex(CAST(elements AS BLOB)) AS raw,typeof(elements) AS kind,updatedAt FROM Entities",
        )
      ).rows[0];
      const store = drizzleDocumentStore(db, "synthetic", undefined, {
        prepareRoot: async (v) => v,
      });
      await expect(
        store.write("payload", { elements: '{"root":{"children":[]}}' }, AT),
      ).rejects.toThrow();
      expect(
        (
          await client.execute(
            "SELECT hex(CAST(elements AS BLOB)) AS raw,typeof(elements) AS kind,updatedAt FROM Entities",
          )
        ).rows[0],
      ).toEqual(before);
    } finally {
      client.close();
    }
  });
}

test("markdown content projection retains revision metadata before the store revalidates authority", async () => {
  const { createdFromMarkdown } = await import("./write");
  const change = createdFromMarkdown(
    {
      id: "payload",
      title: "Synthetic",
      elements: fixture("legacy-metadata.json"),
      updatedAt: AT,
      appState: null,
      tags: [],
    },
    "Edited markdown",
  );
  expect(change.elements).toContain(
    '"unknown":{"retain":"\\u2603","number":1.00}',
  );
  expect(change.elements.startsWith('  {"root":')).toBe(true);
});

test("agent append preserves fresh raw metadata and saved recording", async () => {
  const { appendDocumentEdit } = await import("./agent-edits");
  const { client, db } = await setup();
  try {
    await appendDocumentEdit(
      client,
      {
        elements: fixture("legacy-metadata.json"),
        updatedAt: AT.getTime(),
        parentId: null,
      },
      "payload",
      AT.getTime(),
      AT.getTime() + 1,
      { kind: "append", text: "Added paragraph" },
      undefined,
      (message) => new Error(message),
    );
    const store = drizzleDocumentStore(db, "synthetic", undefined, {
      prepareRoot: async (v) => v,
    });
    const saved = await store.read("payload");
    expect(saved?.elements).toContain(
      ',"tts":{"text":"Legacy hello","audioUrl":"https://example.invalid/saved.mp3"},"unknown":{"retain":"\\u2603","number":1.00}}\n',
    );
    const headless = editor();
    headless.setEditorState(headless.parseEditorState(saved?.elements ?? ""));
    expect(
      headless.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("Legacy hello\n\nAdded paragraph");
  } finally {
    client.close();
  }
});

test("agent append cannot overwrite corrupt current bytes with a stale valid row", async () => {
  const { appendDocumentEdit } = await import("./agent-edits");
  const { client } = await setup("broken");
  try {
    await expect(
      appendDocumentEdit(
        client,
        {
          elements: fixture("legacy-metadata.json"),
          updatedAt: AT.getTime(),
          parentId: null,
        },
        "payload",
        AT.getTime(),
        AT.getTime() + 1,
        { kind: "append", text: "Added" },
        undefined,
        (message) => new Error(message),
      ),
    ).rejects.toThrow();
    expect(
      (await client.execute("SELECT elements,updatedAt FROM Entities")).rows[0],
    ).toMatchObject({ elements: "broken", updatedAt: AT.getTime() });
  } finally {
    client.close();
  }
});
