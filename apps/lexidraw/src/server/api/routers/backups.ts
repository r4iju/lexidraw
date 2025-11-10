import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { z } from "zod";
import {
  listBlobsByPrefix,
  parseBackupKey,
  deleteBlobs,
} from "@packages/lib/blob";
import { TRPCError } from "@trpc/server";

export const backupsRouter = createTRPCRouter({
  list: adminProcedure
    .input(
      z.object({
        dbName: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional().default(100),
      }),
    )
    .query(async ({ input }) => {
      const prefix = input.dbName
        ? `backups/turso/${input.dbName}/`
        : "backups/turso/";

      const result = await listBlobsByPrefix(prefix, input.cursor, input.limit);

      // Parse backup metadata from keys
      const backups = result.blobs
        .map((blob) => {
          const parsed = parseBackupKey(blob.pathname);
          if (!parsed) return null;

          // Try to parse the date from the timestamp
          // Timestamp format: "12-34-56-789" (HH-MM-SS-milliseconds)
          // Need to convert to: "12:34:56.789"
          let backupDate: Date | null = null;
          try {
            // Split timestamp into parts: HH-MM-SS-milliseconds
            const parts = parsed.timestamp.split("-");
            if (parts.length >= 3) {
              const hours = parts[0] ?? "00";
              const minutes = parts[1] ?? "00";
              const seconds = parts[2] ?? "00";
              const milliseconds = parts[3] ?? "000";
              // Construct ISO string: YYYY-MM-DDTHH:MM:SS.mmmZ
              const isoString = `${parsed.year}-${parsed.month}-${parsed.day}T${hours}:${minutes}:${seconds}.${milliseconds}Z`;
              backupDate = new Date(isoString);
              // Validate the date
              if (Number.isNaN(backupDate.getTime())) {
                throw new Error("Invalid date");
              }
            } else {
              throw new Error("Invalid timestamp format");
            }
          } catch {
            // If date parsing fails, try uploadedAt from blob metadata
            try {
              if (blob.uploadedAt) {
                backupDate = new Date(blob.uploadedAt);
                // Validate the date
                if (Number.isNaN(backupDate.getTime())) {
                  backupDate = null;
                }
              }
            } catch {
              backupDate = null;
            }
          }

          return {
            key: blob.pathname,
            // Note: blob.url is intentionally omitted for security
            // Backups are stored as public blobs but URLs should not be exposed
            // All downloads must go through /api/backups/download with admin auth
            size: blob.size,
            dbName: parsed.dbName,
            year: parsed.year,
            month: parsed.month,
            day: parsed.day,
            timestamp: parsed.timestamp,
            backupDate: backupDate?.toISOString() ?? null,
            uploadedAt: blob.uploadedAt,
          };
        })
        .filter(
          (backup): backup is NonNullable<typeof backup> => backup !== null,
        )
        .sort((a, b) => {
          // Sort by date descending (newest first)
          try {
            const dateA = a.backupDate ? new Date(a.backupDate).getTime() : 0;
            const dateB = b.backupDate ? new Date(b.backupDate).getTime() : 0;
            if (Number.isNaN(dateA)) return 1; // Invalid dates go to end
            if (Number.isNaN(dateB)) return -1;
            return dateB - dateA;
          } catch {
            return 0; // If sorting fails, maintain order
          }
        });

      return {
        backups,
        cursor: result.cursor,
        hasMore: result.hasMore ?? false,
      };
    }),

  delete: adminProcedure
    .input(
      z.object({
        key: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      // Validate that this is a backup key
      const parsed = parseBackupKey(input.key);
      if (!parsed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid backup key format",
        });
      }

      // List blobs to find the URL for this key
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
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup not found",
        });
      }

      // Delete the blob
      await deleteBlobs([blob.url]);

      return { success: true };
    }),
});
