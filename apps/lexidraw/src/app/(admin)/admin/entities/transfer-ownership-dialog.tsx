"use client";
import { useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";

export default function TransferOwnershipDialog(props: {
  entityId: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const listUsers = api.adminUsers.list.useQuery(
    { page: 1, size: 50 },
    { enabled: open },
  );
  const transfer = api.adminEntities.transferOwnership.useMutation();

  return (
    <div className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Transfer
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-md border border-border bg-background p-4 shadow-xl">
            <div className="mb-3 text-sm font-medium">Transfer Ownership</div>
            <select
              className="mb-4 w-full border bg-background px-2 py-1 text-sm"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <option value="">Select owner...</option>
              {(listUsers.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.name ?? u.email ?? u.id) as string}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!ownerId || transfer.isPending}
                onClick={async () => {
                  await transfer.mutateAsync({
                    entityId: props.entityId,
                    newOwnerId: ownerId,
                  });
                  setOpen(false);
                  props.onDone?.();
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
