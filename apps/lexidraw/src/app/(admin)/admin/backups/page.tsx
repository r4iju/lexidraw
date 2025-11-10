"use cache: private";

import { Suspense } from "react";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { BackupActions } from "./backup-actions";
import { triggerBackupAction } from "./actions";

async function BackupsContent() {
  const result = await api.backups.list.query({ limit: 100 });

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDate = (dateString: string | Date | null | undefined): string => {
    if (!dateString) return "Unknown";
    try {
      const date =
        typeof dateString === "string" ? new Date(dateString) : dateString;
      return date.toLocaleString();
    } catch {
      return String(dateString);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Database Backups</h1>
        <form action={triggerBackupAction}>
          <Button type="submit" variant="default">
            Run Backup Now
          </Button>
        </form>
      </div>

      {result.backups.length === 0 ? (
        <div className="rounded-md border border-border p-6 text-center text-muted-foreground">
          No backups found. Backups are created daily at 02:05 UTC.
        </div>
      ) : (
        <div className="rounded-md border border-border shadow-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Database</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.backups.map((backup) => (
                <TableRow key={backup.key}>
                  <TableCell className="font-mono text-sm">
                    {backup.dbName}
                  </TableCell>
                  <TableCell>
                    {formatDate(backup.backupDate ?? backup.uploadedAt)}
                  </TableCell>
                  <TableCell>{formatSize(backup.size)}</TableCell>
                  <TableCell>
                    <BackupActions backupKey={backup.key} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {result.hasMore && (
        <div className="text-center text-sm text-muted-foreground">
          Showing first {result.backups.length} backups. Use cursor pagination
          to load more.
        </div>
      )}
    </div>
  );
}

export default async function BackupsPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full p-6">
          <div className="text-center">Loading backups...</div>
        </div>
      }
    >
      <BackupsContent />
    </Suspense>
  );
}
