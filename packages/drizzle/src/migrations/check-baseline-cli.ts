import { createClient } from "@libsql/client";
import env from "@packages/env";
import { assertTrackedMigrationBaseline } from "./migration-baseline.js";

const client = createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN });
try {
  await assertTrackedMigrationBaseline(client);
} finally {
  client.close();
}
