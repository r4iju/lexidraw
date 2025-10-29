"use client";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EntityRow } from "./columns";
import TransferOwnershipDialog from "./transfer-ownership-dialog";
import MembersDialog from "./members-dialog";

export function RowActions({ row }: { row: EntityRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const toggleActive = api.adminEntities.toggleActive.useMutation();
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex gap-2 justify-end">
      <TransferOwnershipDialog
        entityId={row.id}
        onDone={() => router.refresh()}
      />
      <MembersDialog entityId={row.id} onDone={() => router.refresh()} />
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(row.id);
          setCopied(true);
          setTimeout(() => setCopied(false), 1000);
        }}
      >
        {copied ? "Copied" : "Copy ID"}
      </Button>
      <Button
        variant={row.isActive ? "destructive" : "secondary"}
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await toggleActive.mutateAsync({
              entityId: row.id,
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
