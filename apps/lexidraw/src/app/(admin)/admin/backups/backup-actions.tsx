"use client";

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { revalidateBackupsPage } from "./actions";

export function BackupActions({ backupKey }: { backupKey: string }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const utils = api.useUtils();

  const deleteBackup = api.backups.delete.useMutation({
    onSuccess: async () => {
      // Invalidate TRPC query cache
      void utils.backups.list.invalidate();
      // Revalidate Next.js page path to refresh server component
      await revalidateBackupsPage();
      setIsDeleting(false);
      setIsDialogOpen(false);
    },
    onError: (error) => {
      console.error("Failed to delete backup:", error);
      alert(`Failed to delete backup: ${error.message}`);
      setIsDeleting(false);
    },
  });

  const handleDelete = () => {
    setIsDeleting(true);
    deleteBackup.mutate({ key: backupKey });
  };

  const handleDownload = () => {
    // Use server-side decryption endpoint instead of direct blob URL
    const downloadUrl = `/api/backups/download?key=${encodeURIComponent(backupKey)}`;
    window.open(downloadUrl, "_blank");
  };

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleDownload}
        disabled={isDeleting}
      >
        Download
      </Button>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={isDeleting}>
            Delete
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Backup?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this backup? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
