import type { Client } from "@libsql/client";

const aiTableMigrations: Record<string, number> = {
  pro_operations: 1791623795854,
  pro_billing_events: 1791623928723,
  generated_images: 1791640800000,
  pro_narration_jobs: 1791648000000,
  generated_recordings: 1791648000001,
  pro_agent_jobs: 1791648000002,
  device_agent_edits: 1791647826278,
  pro_subscriptions: 1791650516575,
  pro_apple_accounts: 1791658000000,
  pro_chat_documents: 1791660000000,
  generated_image_cleanup_cursor: 1791698049489,
};

export async function assertTrackedMigrationBaseline(client: Client) {
  const tx = await client.transaction("read");
  try {
    const objects = await tx.execute(
      "SELECT lower(name) AS name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    const tables = objects.rows.map((row) => String(row.name));
    const journal = tables.includes("__drizzle_migrations")
      ? await tx.execute(
          "SELECT max(created_at) AS latest FROM __drizzle_migrations",
        )
      : undefined;
    const latest = Number(journal?.rows[0]?.latest ?? 0);
    if (tables.some((name) => name !== "__drizzle_migrations") && !latest) {
      throw new Error(
        "Refusing ordinary migration of an untracked schema; reconcile its baseline first",
      );
    }
    if (tables.some((name) => (aiTableMigrations[name] ?? 0) > latest)) {
      throw new Error(
        "AI schema is ahead of the migration journal; reconcile the managed migration receipt first",
      );
    }
  } finally {
    await tx.rollback();
  }
}
