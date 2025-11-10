import "server-only";

import {
  createReadStream,
  createWriteStream,
  existsSync,
  unlinkSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  randomUUID,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { put } from "@vercel/blob";
import env from "@packages/env";
import {
  generateBackupKey,
  listBlobsByPrefix,
  deleteBlobs,
  parseBackupKey,
} from "@packages/lib/blob";

/**
 * Derives a 32-byte key from the encryption key string using a simple hash.
 * For production, consider using PBKDF2 or scrypt for key derivation.
 */
function deriveKey(encryptionKey: string): Buffer {
  // Use SHA-256 to derive a consistent 32-byte key from the base64 string
  return createHash("sha256").update(encryptionKey).digest();
}

/**
 * Encrypts a file using AES-256-GCM.
 * Returns the path to the encrypted file.
 */
async function encryptFile(filePath: string): Promise<string> {
  const encryptedPath = `${filePath}.enc`;

  if (!existsSync(filePath)) {
    throw new Error(`Source file does not exist: ${filePath}`);
  }

  console.log("[backup] Encrypting file...", {
    filePath,
    encryptedPath,
  });

  const key = deriveKey(env.BACKUP_ENCRYPTION_KEY);
  const iv = randomBytes(16); // 128-bit IV for GCM

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const readStream = createReadStream(filePath);
  const writeStream = createWriteStream(encryptedPath);

  // Write IV at the beginning of the encrypted file (16 bytes)
  writeStream.write(iv);

  // Encrypt and write the file
  await pipeline(readStream, cipher, writeStream);

  // Get the authentication tag (16 bytes for GCM)
  const authTag = cipher.getAuthTag();

  // Append auth tag at the end
  const fs = await import("node:fs/promises");
  const fileHandle = await fs.open(encryptedPath, "a");
  await fileHandle.write(authTag);
  await fileHandle.close();

  console.log("[backup] File encrypted successfully", {
    original: filePath,
    encrypted: encryptedPath,
  });

  // Clean up original file
  try {
    unlinkSync(filePath);
  } catch (cleanupError) {
    console.warn("[backup] Failed to cleanup original file", {
      error: (cleanupError as Error).message,
    });
  }

  return encryptedPath;
}

/**
 * Decrypts a file using AES-256-GCM.
 * Returns the path to the decrypted file.
 */
export async function decryptBackupFile(
  encryptedFilePath: string,
  outputPath?: string,
): Promise<string> {
  if (!existsSync(encryptedFilePath)) {
    throw new Error(`Encrypted file does not exist: ${encryptedFilePath}`);
  }

  const decryptedPath = outputPath || encryptedFilePath.replace(/\.enc$/, "");

  console.log("[backup] Decrypting file...", {
    encryptedFilePath,
    decryptedPath,
  });

  const key = deriveKey(env.BACKUP_ENCRYPTION_KEY);
  const fs = await import("node:fs/promises");

  // Read the entire file
  const encryptedData = await fs.readFile(encryptedFilePath);

  // Extract IV (first 16 bytes) and auth tag (last 16 bytes)
  const iv = encryptedData.subarray(0, 16);
  const authTag = encryptedData.subarray(-16);
  const ciphertext = encryptedData.subarray(16, -16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  // Decrypt
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  // Write decrypted data
  await fs.writeFile(decryptedPath, decrypted);

  console.log("[backup] File decrypted successfully", {
    encrypted: encryptedFilePath,
    decrypted: decryptedPath,
  });

  return decryptedPath;
}

/**
 * Downloads a Turso database dump via HTTP.
 * Returns the path to the downloaded SQL dump file.
 */
async function downloadTursoDumpHttp(): Promise<string> {
  const tempDir = process.env.TMPDIR || "/tmp";
  const dumpPath = join(tempDir, `turso-backup-${randomUUID()}.sql`);

  try {
    if (!env.TURSO_TOKEN) {
      throw new Error(
        "TURSO_TOKEN environment variable must be set for backups",
      );
    }

    // Normalize TURSO_URL to HTTPS for HTTP access
    const originalUrl = new URL(env.TURSO_URL);
    // Replace libsql:// with https://
    const httpsBase = `https://${originalUrl.hostname}${originalUrl.pathname}`;
    const dumpUrl = `${httpsBase}/dump`;

    console.log("[backup] Downloading database dump via HTTP...", {
      dumpUrl: httpsBase, // Log base URL without exposing token
    });

    // Fetch the dump via HTTP with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600_000); // 10 minute timeout for large dumps

    let response: Response;
    try {
      response = await fetch(dumpUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${env.TURSO_TOKEN}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Request timeout while downloading database dump");
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText}: Failed to download database dump`,
      );
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    // Stream response to file
    const writeStream = createWriteStream(dumpPath);
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          writeStream.write(Buffer.from(value));
        }
      }
      writeStream.end();
    } finally {
      reader.releaseLock();
    }

    // Wait for write stream to finish
    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    if (!existsSync(dumpPath)) {
      throw new Error("Dump file was not created");
    }

    const fs = await import("node:fs/promises");
    const stats = await fs.stat(dumpPath);
    console.log("[backup] Database dump downloaded successfully", {
      dumpPath,
      size: stats.size,
    });

    return dumpPath;
  } catch (error) {
    // Cleanup on error
    if (existsSync(dumpPath)) {
      try {
        unlinkSync(dumpPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    throw new Error(
      `Failed to download Turso database dump: ${(error as Error).message}`,
    );
  }
}

/**
 * Gzips a file and returns the path to the gzipped file.
 */
async function gzipFile(filePath: string): Promise<string> {
  const gzippedPath = `${filePath}.gz`;

  if (!existsSync(filePath)) {
    throw new Error(`Source file does not exist: ${filePath}`);
  }

  console.log("[backup] Compressing file...", {
    filePath,
    gzippedPath,
  });

  // Stream gzip compression
  const readStream = createReadStream(filePath);
  const writeStream = createWriteStream(gzippedPath);
  const gzipStream = createGzip({ level: 6 }); // Balanced compression

  await pipeline(readStream, gzipStream, writeStream);

  console.log("[backup] File compressed successfully", {
    original: filePath,
    compressed: gzippedPath,
  });

  // Clean up original file
  try {
    unlinkSync(filePath);
  } catch (cleanupError) {
    console.warn("[backup] Failed to cleanup original file", {
      error: (cleanupError as Error).message,
    });
  }

  return gzippedPath;
}

/**
 * Uploads a backup file to Vercel Blob storage.
 * Returns the public URL of the uploaded blob.
 */
async function uploadBackupBlob(
  key: string,
  filePath: string,
): Promise<string> {
  if (!existsSync(filePath)) {
    throw new Error(`Backup file does not exist: ${filePath}`);
  }

  console.log("[backup] Uploading backup to blob storage...", {
    key,
    filePath,
  });

  // Read file into buffer
  const fileBuffer = readFileSync(filePath);

  const { url } = await put(key, fileBuffer, {
    access: "public", // Vercel Blob limitation - no private access option
    contentType: "application/octet-stream", // Encrypted binary data
    token: env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: true,
    allowOverwrite: true,
  });

  console.log("[backup] Backup uploaded successfully", {
    key,
    url,
    size: fileBuffer.length,
  });

  // Clean up local file
  try {
    unlinkSync(filePath);
  } catch (cleanupError) {
    console.warn("[backup] Failed to cleanup local file", {
      error: (cleanupError as Error).message,
    });
  }

  return url;
}

/**
 * Cleans up backups older than the specified number of days for a given database.
 * Returns the number of backups deleted.
 */
async function deleteOldBackups(
  dbName: string,
  retentionDays = 30,
): Promise<number> {
  const prefix = `backups/turso/${dbName}/`;
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays);

  console.log("[backup] Starting cleanup of old backups", {
    dbName,
    prefix,
    cutoffDate: cutoffDate.toISOString(),
  });

  let totalDeleted = 0;
  let cursor: string | undefined;

  // List all backups for this database
  do {
    const result = await listBlobsByPrefix(prefix, cursor, 1000);

    const urlsToDelete: string[] = [];

    for (const blob of result.blobs) {
      const parsed = parseBackupKey(blob.pathname);
      if (!parsed) {
        console.warn("[backup] Could not parse backup key", {
          pathname: blob.pathname,
        });
        continue;
      }

      // Parse timestamp from the backup key
      try {
        // Replace dashes in timestamp with colons for time, but keep milliseconds
        const timePart = parsed.timestamp.replace(/-/g, ":");
        const backupDate = new Date(
          `${parsed.year}-${parsed.month}-${parsed.day}T${timePart}Z`,
        );

        if (backupDate < cutoffDate) {
          urlsToDelete.push(blob.url);
          console.log("[backup] Marking backup for deletion", {
            pathname: blob.pathname,
            backupDate: backupDate.toISOString(),
            ageDays: Math.floor(
              (Date.now() - backupDate.getTime()) / (1000 * 60 * 60 * 24),
            ),
          });
        }
      } catch (dateError) {
        console.warn("[backup] Could not parse backup date", {
          pathname: blob.pathname,
          error: (dateError as Error).message,
        });
      }
    }

    // Delete old backups in batches
    if (urlsToDelete.length > 0) {
      await deleteBlobs(urlsToDelete);
      totalDeleted += urlsToDelete.length;
      console.log("[backup] Deleted batch of old backups", {
        count: urlsToDelete.length,
        totalDeleted,
      });
    }

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  console.log("[backup] Cleanup complete", {
    totalDeleted,
    dbName,
  });

  return totalDeleted;
}

/**
 * Runs a complete Turso database backup workflow:
 * 1. Downloads database dump via HTTP
 * 2. Gzips the dump
 * 3. Encrypts the gzipped file
 * 4. Uploads to blob storage
 * 5. Cleans up old backups (30-day retention)
 *
 * Returns the backup key and URL.
 */
export async function runTursoBackup(
  dbName: string,
): Promise<{ key: string; url: string }> {
  console.log("[backup] Starting backup workflow", { dbName });

  // Step 1: Download database dump via HTTP
  const dumpPath = await downloadTursoDumpHttp();
  console.log("[backup] Database dump downloaded", { dumpPath });

  // Step 2: Gzip the dump
  const gzippedPath = await gzipFile(dumpPath);
  console.log("[backup] Dump compressed", { gzippedPath });

  // Step 3: Encrypt the gzipped file
  const encryptedPath = await encryptFile(gzippedPath);
  console.log("[backup] Dump encrypted", { encryptedPath });

  // Step 4: Upload to blob storage
  const timestamp = new Date();
  const backupKey = generateBackupKey(dbName, timestamp, "sql.gz");
  const backupUrl = await uploadBackupBlob(backupKey, encryptedPath);
  console.log("[backup] Backup uploaded", { backupKey, backupUrl });

  // Step 5: Cleanup old backups (older than 30 days)
  const deletedCount = await deleteOldBackups(dbName, 30);
  console.log("[backup] Cleanup complete", { deletedCount });

  return { key: backupKey, url: backupUrl };
}
