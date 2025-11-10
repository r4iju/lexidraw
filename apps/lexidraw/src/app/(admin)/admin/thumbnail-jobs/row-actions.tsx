"use client";

import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ThumbnailJobRow } from "./columns";

export function RowActions({ job }: { job: ThumbnailJobRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const deleteJob = api.adminThumbnailJobs.delete.useMutation();

  return (
    <div className="flex gap-2 justify-end">
      <Button
        variant="destructive"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await deleteJob.mutateAsync({ id: job.id });
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Deleting..." : "Delete"}
      </Button>
    </div>
  );
}

