import { expect, test } from "bun:test";
import { createClient } from "@libsql/client/sqlite3";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@packages/drizzle/document-data-schema";
import { PublicAccess } from "@packages/types";
import { readFileSync } from "node:fs";
import { drizzleDrawingStore } from "./drawing-store";

const original =
  '[{"id":"rectangle","type":"rectangle","x":0,"y":0,"width":160,"height":90}]';
const edited =
  '[{"id":"rectangle","type":"rectangle","x":75,"y":0,"width":200,"height":90}]';
const settings = '{"viewBackgroundColor":"#ffffff"}';

test("an existing drawing can save and reopen its element array without document-root processing", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    for (const sql of readFileSync(
      new URL(
        "../../../../../packages/drizzle/tests/fixtures/conversion-modern-v1/destination.sql",
        import.meta.url,
      ),
      "utf8",
    ).split("--> statement-breakpoint"))
      if (sql.trim()) await client.execute(sql);
    await client.execute(
      "INSERT INTO Users (id,name,isActive,createdAt,updatedAt) VALUES ('tester','Tester',1,42,42)",
    );
    const db = drizzle(client, { schema });
    const revision = new Date(42);
    await db.insert(schema.entities).values({
      id: "drawing",
      title: "Kept drawing",
      elements: original,
      appState: settings,
      entityType: "drawing",
      userId: "tester",
      publicAccess: PublicAccess.PRIVATE,
      createdAt: revision,
      updatedAt: revision,
    });
    const store = drizzleDrawingStore(db, "tester");
    const saved = await store.write("drawing", { elements: edited }, revision);
    expect(saved?.id).toBe("drawing");
    expect(saved?.updatedAt.getTime()).toBeGreaterThan(42);
    const reopened = await store.read("drawing");
    expect(reopened?.elements).toBe(edited);
    expect(reopened?.title).toBe("Kept drawing");
    expect(reopened?.appState).toBe(settings);
    expect(reopened?.updatedAt).toEqual(saved?.updatedAt);
  } finally {
    client.close();
  }
});
