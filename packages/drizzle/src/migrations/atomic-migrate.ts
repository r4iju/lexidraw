import { sql, type SQL } from "drizzle-orm";
import { readMigrationFiles, type MigrationConfig } from "drizzle-orm/migrator";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import type { InStatement, Row } from "@libsql/client";
import type { MigrationExecutor, MigrationOwner } from "./file-migration-owner";

export type MigrationPreflight = (
  executor: MigrationExecutor,
  latest: Row | undefined,
) => Promise<void>;

export async function runAtomicMigrations(
  owner: MigrationOwner,
  config: MigrationConfig,
  preflight: MigrationPreflight,
): Promise<void> {
  const migrations = readMigrationFiles(config);
  const tableName = config.migrationsTable ?? "__drizzle_migrations";
  const table = sql.identifier(tableName);
  const dialect = new SQLiteAsyncDialect();
  const compile = (statement: SQL): InStatement => {
    const query = dialect.sqlToQuery(statement);
    return {
      sql: query.sql,
      args: query.params.map((value) => {
        if (typeof value === "string" || typeof value === "number")
          return value;
        throw new Error("Unsupported compiled migration parameter");
      }),
    };
  };
  const inspect = async (executor: MigrationExecutor) => {
    const exists = await executor.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      args: [tableName],
    });
    return exists.rows.length
      ? (
          await executor.execute(
            compile(
              sql`SELECT id, hash, created_at FROM ${table} ORDER BY created_at DESC LIMIT 1`,
            ),
          )
        ).rows[0]
      : undefined;
  };
  await owner.write(async (executor) => {
    const latest = await inspect(executor);
    await preflight(executor, latest);
    await executor.execute(
      compile(
        sql`CREATE TABLE IF NOT EXISTS ${table} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
      ),
    );
    for (const migration of migrations) {
      if (!latest || Number(latest.created_at) < migration.folderMillis) {
        for (const [index, statement] of migration.sql.entries()) {
          try {
            await executor.execute(statement);
          } catch (cause) {
            throw new Error(
              `Migration ${migration.folderMillis} split statement ${index} failed`,
              { cause },
            );
          }
        }
        await executor.execute(
          compile(
            sql`INSERT INTO ${table} ("hash", "created_at") VALUES (${migration.hash}, ${migration.folderMillis})`,
          ),
        );
      }
    }
  });
}
