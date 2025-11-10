import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { isAdmin } from "~/server/admin";
import { listBlobsByPrefix, parseBackupKey } from "@packages/lib/blob";
import { decryptBackupFile } from "~/server/backup/turso-backup";
import { createReadStream } from "node:fs";
import { createWriteStream, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export async function GET(req: NextRequest) {
  // Check admin authentication
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isUserAdmin = await isAdmin();
  if (!isUserAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Get backup key from query parameter
  const searchParams = req.nextUrl.searchParams;
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json(
      { error: "Missing backup key parameter" },
      { status: 400 },
    );
  }

  // Validate backup key format
  const parsed = parseBackupKey(key);
  if (!parsed) {
    return NextResponse.json(
      { error: "Invalid backup key format" },
      { status: 400 },
    );
  }

  try {
    // Find the blob by key
    // Note: When addRandomSuffix: true, the pathname includes a random suffix,
    // so we need to match by parsing the pathname and comparing metadata
    const prefix = `backups/turso/${parsed.dbName}/`;
    const result = await listBlobsByPrefix(prefix);

    // Find blob by matching parsed metadata (handles random suffixes)
    const blob = result.blobs.find((b) => {
      const blobParsed = parseBackupKey(b.pathname);
      if (!blobParsed) return false;
      return (
        blobParsed.dbName === parsed.dbName &&
        blobParsed.year === parsed.year &&
        blobParsed.month === parsed.month &&
        blobParsed.day === parsed.day &&
        blobParsed.timestamp === parsed.timestamp &&
        blobParsed.ext === parsed.ext
      );
    });
    if (!blob) {
      return NextResponse.json({ error: "Backup not found" }, { status: 404 });
    }

    // Download the encrypted blob with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000); // 5 minute timeout

    let encryptedResponse: Response;
    try {
      encryptedResponse = await fetch(blob.url, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json({ error: "Request timeout" }, { status: 408 });
      }
      return NextResponse.json(
        { error: "Failed to fetch backup from storage" },
        { status: 500 },
      );
    }

    if (!encryptedResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch backup from storage" },
        { status: 500 },
      );
    }

    // Save encrypted blob to temp file
    const tempDir = process.env.TMPDIR || "/tmp";
    const encryptedPath = join(tempDir, `backup-encrypted-${randomUUID()}.enc`);
    const decryptedPath = join(tempDir, `backup-decrypted-${randomUUID()}.gz`);

    try {
      // Write encrypted blob to temp file
      const writeStream = createWriteStream(encryptedPath);
      const reader = encryptedResponse.body?.getReader();

      if (!reader) {
        return NextResponse.json(
          { error: "Failed to read backup from storage" },
          { status: 500 },
        );
      }

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

      // Decrypt the file
      await decryptBackupFile(encryptedPath, decryptedPath);

      // Stream the decrypted file back to the client
      if (!existsSync(decryptedPath)) {
        return NextResponse.json(
          { error: "Failed to decrypt backup" },
          { status: 500 },
        );
      }

      // Extract filename from key (last part of the path)
      // Sanitize filename to prevent injection attacks
      const rawFilename = key.split("/").pop() ?? "backup.sql.gz";
      // Remove any path traversal attempts and special characters
      const filename =
        rawFilename
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .replace(/\.\./g, "")
          .substring(0, 255) || "backup.sql.gz";

      // Create a ReadableStream from the file
      const fileStream = createReadStream(decryptedPath);
      const cleanup = () => {
        try {
          if (existsSync(encryptedPath)) unlinkSync(encryptedPath);
          if (existsSync(decryptedPath)) unlinkSync(decryptedPath);
        } catch (cleanupError) {
          console.warn("[backup] Failed to cleanup temp files", {
            error: (cleanupError as Error).message,
          });
        }
      };

      const readableStream = new ReadableStream({
        start(controller) {
          fileStream.on("data", (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            controller.enqueue(new Uint8Array(buffer));
          });
          fileStream.on("end", () => {
            controller.close();
            // Cleanup after stream completes
            cleanup();
          });
          fileStream.on("error", (error) => {
            controller.error(error);
            cleanup();
          });
        },
        cancel() {
          fileStream.destroy();
          cleanup();
        },
      });

      // Return streaming response
      return new NextResponse(readableStream, {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (cleanupError) {
      // Cleanup on error
      try {
        if (existsSync(encryptedPath)) unlinkSync(encryptedPath);
        if (existsSync(decryptedPath)) unlinkSync(decryptedPath);
      } catch {
        // Ignore cleanup errors
      }
      throw cleanupError;
    }
  } catch (error) {
    console.error("[backup] Download error:", error);
    // Don't expose internal error details to client
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
