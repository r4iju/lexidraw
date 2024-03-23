import { drizzle, LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import env from '@packages/env';
import * as schema from './drizzle-schema';

const globalForDrizzle = globalThis as unknown as {
  db: LibSQLDatabase<typeof schema> | undefined;
};

const createSingleton = () => {
  const turso = createClient({
    url: env.TURSO_URL,
    authToken: env.TURSO_TOKEN,
  });
  return drizzle<typeof schema>(turso, {
    schema,
    logger: true,
  });
};

export const db = globalForDrizzle.db ?? createSingleton();

if (env.NODE_ENV !== 'production') globalForDrizzle.db = db;
