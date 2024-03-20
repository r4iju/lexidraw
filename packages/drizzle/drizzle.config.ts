import type { Config } from 'drizzle-kit';
import env from '@packages/env';
export default {
  schema: './src/drizzle-schema.ts',
  out: './drizzle',
  // driver: 'libsql',
  // dbCredentials: {
  //   url: 'file:./dev.db',
  // },
  driver: 'turso',
  dbCredentials: {
    url: env.TURSO_URL,
    authToken: env.TURSO_TOKEN,
  },
} satisfies Config;
