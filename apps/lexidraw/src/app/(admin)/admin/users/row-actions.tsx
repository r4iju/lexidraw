"use client";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { UserRow } from "./columns";

export function RowActions({ row }: { row: UserRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const start = api.adminUsers.impersonateStart.useMutation();
  const stop = api.adminUsers.impersonateStop.useMutation();
  const toggleActive = api.adminUsers.toggleActive.useMutation();

  return (
    <div className="flex gap-2 justify-end">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await start.mutateAsync({ userId: row.id });
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        Impersonate
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await stop.mutateAsync();
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        Stop
      </Button>
      <Button
        variant={row.isActive ? "destructive" : "secondary"}
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await toggleActive.mutateAsync({
              userId: row.id,
              active: !row.isActive,
            });
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        {row.isActive ? "Deactivate" : "Activate"}
      </Button>
    </div>
  );
}
