import type { Client } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate as drizzleMigrate } from "drizzle-orm/libsql/migrator";
import type { MigrationConfig } from "drizzle-orm/migrator";

const legacyColumns = [
  ["id", "TEXT", 1, null, 1, 0],
  ["documentId", "TEXT", 1, null, 0, 0],
  ["userId", "TEXT", 1, null, 0, 0],
  ["status", "TEXT", 1, null, 0, 0],
  ["manifestUrl", "TEXT", 0, null, 0, 0],
  ["stitchedUrl", "TEXT", 0, null, 0, 0],
  ["segmentCount", "INTEGER", 0, null, 0, 0],
  ["error", "TEXT", 0, null, 0, 0],
  ["ttsConfig", "TEXT", 0, null, 0, 0],
  ["createdAt", "INTEGER", 1, null, 0, 0],
  ["updatedAt", "INTEGER", 1, null, 0, 0],
  ["plannedCount", "INTEGER", 0, null, 0, 0],
];

const legacyTable = `CREATE TABLE TtsJobs (
 id text PRIMARY KEY NOT NULL, documentId text NOT NULL, userId text NOT NULL,
 status text NOT NULL, manifestUrl text, stitchedUrl text, segmentCount integer,
 error text, ttsConfig text, createdAt integer NOT NULL, updatedAt integer NOT NULL,
 plannedCount integer,
 FOREIGN KEY (documentId) REFERENCES Entities(id) ON UPDATE cascade ON DELETE cascade,
 FOREIGN KEY (userId) REFERENCES Users(id) ON UPDATE cascade ON DELETE cascade
)`;

function normalize(sql: string) {
  return sql
    .replace(
      /`([^`]*)`|"([^"]*)"|\s+|;/g,
      (_match, backtick, quoted) => backtick ?? quoted ?? "",
    )
    .toLowerCase();
}

// These unjournaled 0015/0016 layouts cannot reach 0034's entityId index.
// Recognize only the complete declared shape; leave other conversions explicit.
export async function migrate<TSchema extends Record<string, unknown>>(
  db: LibSQLDatabase<TSchema> & { $client: Client },
  options: MigrationConfig,
): Promise<void> {
  const transaction = await db.$client.transaction("write");
  try {
    const legacyDocuments = (
      await transaction.execute(
        "SELECT name FROM sqlite_master WHERE name COLLATE NOCASE IN ('Document', 'SharedDocument') LIMIT 1",
      )
    ).rows;
    // Empty checks cannot safely precede the separately connected Drizzle runner.
    // Retain every legacy object until conversion and atomic continuation exist.
    if (legacyDocuments.length > 0) {
      throw new Error(
        "Legacy Document/SharedDocument object detected; migration stopped before 0002_flippant_red_ghost. Original data is retained. An authoritative document conversion is required before continuing; atomic empty continuation is unavailable for empty, partial or unsupported legacy schemas.",
      );
    }
    const columns = (await transaction.execute("PRAGMA table_xinfo(TtsJobs)"))
      .rows;
    if (
      columns.some((row) => String(row.name).toLowerCase() === "documentid")
    ) {
      const definitions = (
        await transaction.execute(
          "SELECT type,name,sql FROM sqlite_master WHERE tbl_name = 'TtsJobs' ORDER BY type,name",
        )
      ).rows;
      const expected = [
        [
          "index",
          "TtsJobs_documentId_idx",
          "CREATE INDEX TtsJobs_documentId_idx ON TtsJobs(documentId)",
        ],
        [
          "index",
          "TtsJobs_status_idx",
          "CREATE INDEX TtsJobs_status_idx ON TtsJobs(status)",
        ],
        ["index", "sqlite_autoindex_TtsJobs_1", null],
        ["table", "TtsJobs", legacyTable],
      ] as const;
      const actual = definitions.map((row) => [
        row.type,
        row.name,
        row.sql === null ? null : normalize(String(row.sql)),
      ]);
      const known = expected.map(([type, name, sql]) => [
        type,
        name,
        sql === null ? null : normalize(sql),
      ]);
      const shape = columns.map((row) => [
        row.name,
        row.type,
        row.notnull,
        row.dflt_value,
        row.pk,
        row.hidden,
      ]);
      if (
        JSON.stringify(shape) !== JSON.stringify(legacyColumns) ||
        JSON.stringify(actual) !== JSON.stringify(known)
      ) {
        throw new Error("Unsupported legacy TtsJobs schema; migration stopped");
      }
      await transaction.execute(
        "ALTER TABLE TtsJobs RENAME COLUMN documentId TO entityId",
      );
      await transaction.execute("DROP INDEX TtsJobs_documentId_idx");
      await transaction.execute(
        "CREATE INDEX TtsJobs_entityId_idx ON TtsJobs(entityId)",
      );
      await transaction.execute("ALTER TABLE TtsJobs ADD runId text");
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
  await drizzleMigrate(db, options);
}
