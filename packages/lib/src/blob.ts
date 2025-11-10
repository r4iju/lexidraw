import { list, del, type ListBlobResult } from "@vercel/blob";
import env from "@packages/env";

/**
 * List blobs with a given prefix (e.g., "backups/turso/db-name/")
 */
export async function listBlobsByPrefix(
  prefix: string,
  cursor?: string,
  limit = 1000,
): Promise<ListBlobResult> {
  return list({
    prefix,
    cursor,
    limit,
    token: env.BLOB_READ_WRITE_TOKEN,
  });
}

/**
 * Delete blobs by their URLs
 */
export async function deleteBlobs(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  await del(urls, { token: env.BLOB_READ_WRITE_TOKEN });
}

/**
 * Generate backup blob key path
 * Format: backups/turso/<dbName>/<YYYY>/<MM>/<DD>/<timestamp>.<ext>
 * @param ext - File extension, either "sqlite.gz" or "sql.gz" (default: "sqlite.gz")
 */
export function generateBackupKey(
  dbName: string,
  timestamp: Date = new Date(),
  ext: "sqlite.gz" | "sql.gz" = "sqlite.gz",
): string {
  const year = timestamp.getUTCFullYear();
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, "0");
  const day = String(timestamp.getUTCDate()).padStart(2, "0");
  const ts = timestamp.toISOString().replace(/[:.]/g, "-").replace("Z", "");
  return `backups/turso/${dbName}/${year}/${month}/${day}/${ts}.${ext}`;
}

/**
 * Parse backup key to extract metadata
 * Supports both .sqlite.gz and .sql.gz extensions
 * Handles random suffixes added by Vercel Blob when addRandomSuffix: true
 * Format: backups/turso/<dbName>/<YYYY>/<MM>/<DD>/<timestamp>.<type>[-randomSuffix].gz
 */
export function parseBackupKey(key: string): {
  dbName: string;
  year: string;
  month: string;
  day: string;
  timestamp: string;
  ext: "sqlite.gz" | "sql.gz";
} | null {
  // Match both .sqlite.gz and .sql.gz extensions
  // Also handles random suffix: .sql-{random}.gz or .sqlite-{random}.gz
  // Timestamp format: YYYY-MM-DDTHH-MM-SS-milliseconds (no dots in timestamp)
  // Use [^.] to match everything up to the first dot before the extension
  const match = key.match(
    /^backups\/turso\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/([^.]+)\.(sqlite|sql)(?:-[^.]*)?\.gz$/,
  );
  if (
    !match ||
    !match[1] ||
    !match[2] ||
    !match[3] ||
    !match[4] ||
    !match[5] ||
    !match[6]
  ) {
    return null;
  }
  const ext = match[6] === "sql" ? "sql.gz" : "sqlite.gz";
  return {
    dbName: match[1],
    year: match[2],
    month: match[3],
    day: match[4],
    timestamp: match[5],
    ext,
  };
}
