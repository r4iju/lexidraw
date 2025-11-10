import env from "@packages/env";

/**
 * Extracts the database name from TURSO_URL.
 * Turso URLs typically follow the pattern: https://<db-name>-<org>.turso.io
 * or https://<db-name>.turso.io
 */
export function getTursoDbName(): string {
  try {
    const url = new URL(env.TURSO_URL);
    // Extract database name from hostname
    // Examples:
    // - https://my-db-org.turso.io -> my-db-org
    // - https://my-db.turso.io -> my-db
    // - https://my-db-org-12345.turso.io -> my-db-org-12345
    const hostname = url.hostname;

    // Remove .turso.io suffix
    if (hostname.endsWith(".turso.io")) {
      return hostname.slice(0, -".turso.io".length);
    }

    // Fallback: use the hostname as-is
    return hostname;
  } catch {
    // If URL parsing fails, return default
    return "default";
  }
}
