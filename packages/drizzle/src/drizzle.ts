import { createClient } from "@libsql/client";
import env from "@packages/env";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./drizzle-schema.js";

type Schema = typeof schema;

const globalForDrizzle = globalThis as unknown as {
  db: LibSQLDatabase<Schema> | undefined;
};

const createSingleton = () => {
  const turso = createClient({
    url: env.TURSO_URL,
    authToken: env.TURSO_TOKEN,
  });
  return drizzle<Schema>(turso, {
    schema,
    logger: true,
  });
};

export const db = globalForDrizzle.db ?? createSingleton();

if (env.NODE_ENV !== "production") globalForDrizzle.db = db;
