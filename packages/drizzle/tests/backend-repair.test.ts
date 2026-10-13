import { expect, test } from "bun:test";
// This is the tool-owned fixture itself; JSON import infers its actual fields.
import journal from "../drizzle/meta/_journal.json";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = resolve(import.meta.dir, "../drizzle");
async function folder(dir: string, through: number) {
  await mkdir(join(dir, "meta"), { recursive: true });
  const entries = journal.entries.filter(
    (entry) => entry.idx >= 15 && entry.idx <= through,
  );
  await writeFile(
    join(dir, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries)
    await copyFile(
      join(source, `${entry.tag}.sql`),
      join(dir, `${entry.tag}.sql`),
    );
  return dir;
}

for (const history of [
  "fresh feature",
  "incremental 0027",
  "already recorded 0030",
] as const) {
  test(`local migrator repairs receipt definitions and image indexes for ${history}, repeat is idempotent`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "lexidraw-backend-repair-"));
    const client = createClient({ url: `file:${join(dir, "test.sqlite")}` });
    const db = drizzle(client);
    try {
      if (history !== "fresh feature") {
        await migrate(db, {
          migrationsFolder: await folder(join(dir, "through27"), 27),
        });
        if (history === "already recorded 0030")
          await migrate(db, {
            migrationsFolder: await folder(join(dir, "through30"), 30),
          });
        expect(
          (
            await client.execute(
              "SELECT name FROM sqlite_master WHERE name='device_agent_edits'",
            )
          ).rows,
        ).toHaveLength(0);
        expect(
          (
            await client.execute(
              "SELECT name FROM sqlite_master WHERE name IN ('generated_images_account','generated_images_expiry')",
            )
          ).rows,
        ).toHaveLength(0);
      }
      const before = (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
        )
      ).rows.length
        ? (
            await client.execute(
              "SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at",
            )
          ).rows
        : [];
      const migrationsFolder = await folder(join(dir, "current"), Infinity);
      await migrate(db, { migrationsFolder });
      expect(
        (
          await client.execute("PRAGMA table_info(device_agent_edits)")
        ).rows.map((row) => [row.name, row.type, row.notnull, row.pk]),
      ).toEqual([
        ["account_id", "TEXT", 1, 1],
        ["document_id", "TEXT", 1, 0],
        ["step_key", "TEXT", 1, 2],
        ["input_hash", "TEXT", 1, 0],
        ["receipt", "TEXT", 1, 0],
        ["created_at", "INTEGER", 1, 0],
      ]);
      for (const [name, columns] of [
        ["generated_images_account", ["account_id", "state"]],
        ["generated_images_expiry", ["state", "expires_at"]],
      ] as const)
        expect(
          (await client.execute(`PRAGMA index_info(${name})`)).rows.map(
            (row) => row.name,
          ),
        ).toEqual([...columns]);
      const records = (
        await client.execute(
          "SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at",
        )
      ).rows;
      expect(records.slice(0, before.length)).toEqual(before);
      await migrate(db, { migrationsFolder });
      expect(
        (
          await client.execute(
            "SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at",
          )
        ).rows,
      ).toEqual(records);
      // Only these repairs promise statement-level idempotence; ordinary and future
      // migrations rely on the full-journal migrator repeat above to skip applied SQL.
      const repairs = journal.entries.filter(
        (entry) =>
          entry.tag === "0032_backend_migration_repair" ||
          entry.tag === "0034_tts_jobs_baseline",
      );
      for (const entry of repairs)
        for (const sql of (
          await readFile(join(source, `${entry.tag}.sql`), "utf8")
        ).split("--> statement-breakpoint"))
          if (sql.trim()) await client.execute(sql);
    } finally {
      client.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
