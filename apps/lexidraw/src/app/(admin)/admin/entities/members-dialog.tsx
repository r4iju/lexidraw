"use client";
import { useEffect, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";

export default function MembersDialog(props: {
  entityId: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const list = api.adminEntities.members.useQuery(
    { entityId: props.entityId },
    { enabled: open },
  );
  const add = api.adminEntities.addMember.useMutation();
  const remove = api.adminEntities.removeMember.useMutation();

  useEffect(() => {
    if (!open) setAddUserId("");
  }, [open]);

  return (
    <div className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Members
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-md border border-border bg-background p-4 shadow-xl">
            <div className="mb-3 text-sm font-medium">Members</div>
            <div className="max-h-64 overflow-y-auto rounded border">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left">User</th>
                    <th className="p-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(list.data ?? []).map((m) => (
                    <tr key={m.userId} className="border-t border-border">
                      <td className="p-2">
                        {(m.name ?? m.email ?? m.userId) as string}
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={async () => {
                            await remove.mutateAsync({
                              entityId: props.entityId,
                              userId: m.userId,
                            });
                            await list.refetch();
                            props.onDone?.();
                          }}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                className="flex-1 rounded border bg-background px-2 py-1 text-sm"
                placeholder="Add member by user ID"
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!addUserId}
                onClick={async () => {
                  await add.mutateAsync({
                    entityId: props.entityId,
                    userId: addUserId,
                  });
                  setAddUserId("");
                  await list.refetch();
                  props.onDone?.();
                }}
              >
                Add
              </Button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
