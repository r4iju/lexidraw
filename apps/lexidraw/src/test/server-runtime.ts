/// <reference types="bun" />
import { createClient } from "@libsql/client";
import * as schema from "@packages/drizzle/drizzle-schema";
import { mock } from "bun:test";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

/**
 * Makes a route handler's module graph loadable inside `bun test`, pointed at
 * a database that only this process can see.
 *
 * Two things sit between the server and a test process: `server-only` throws
 * outside a Next build, and the validated env refuses to load without two
 * variables `.env.test` has no reason to carry. Both fixes are process-global,
 * so this has to run before the first import of anything under `~/server`, and
 * a caller imports the route dynamically once it has resolved.
 *
 * `bun test` runs every file in one process, and `@packages/drizzle` resolves
 * its singleton at the first import of the package, so only the first
 * installation is the database the routes in this process talk to. A later
 * caller is handed that one back and seeds rows of its own into it, which is
 * why each test file's ids have to be its own.
 *
 * The tables are the schema itself, rendered to DDL by drizzle-kit rather than
 * copied: the stored migrations begin mid-history and cannot be replayed from
 * empty, and a hand-written subset would drift away from the columns the
 * procedures read. The database goes into the singleton's own global slot,
 * which `@packages/drizzle` reads once at import, so the real one is never
 * opened.
 */
export async function installServerRuntime(): Promise<
  LibSQLDatabase<typeof schema>
> {
  mock.module("server-only", () => ({}));
  const installed = (globalThis as { db?: LibSQLDatabase<typeof schema> }).db;
  if (installed) return installed;
  const runtimeEnv = process.env as Record<string, string | undefined>;
  runtimeEnv.MEDIA_DOWNLOADER_URL ??= "http://media-downloader.test";
  // `bun test` sets NODE_ENV itself; a plain `bun` run of a harness does not.
  runtimeEnv.NODE_ENV ??= "test";

  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  const statements = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema as never),
  );
  for (const statement of statements) await client.execute(statement);

  (globalThis as { db?: LibSQLDatabase<typeof schema> }).db = db;
  return db;
}
