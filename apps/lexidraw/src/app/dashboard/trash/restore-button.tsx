"use client";

import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { revalidateDashboard } from "../server-actions";

type Props = {
  file: Pick<RouterOutputs["entities"]["trash"][number], "id" | "title">;
};

/** Takes a file out of the Trash and says where it went back to. */
export function RestoreButton({ file }: Props) {
  const { mutate: restore, isPending } = api.entities.restore.useMutation();

  const handleRestore = () =>
    restore(
      { id: file.id },
      {
        onSuccess: async ({ parentId }) => {
          await revalidateDashboard();
          toast.success(
            `Restored “${file.title}” to ${parentId ? "its folder" : "Home"}.`,
          );
        },
        onError: (error) => {
          toast.error(`Couldn’t restore “${file.title}”. Try again.`, {
            description: error.message,
          });
        },
      },
    );

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleRestore}
      disabled={isPending}
    >
      Restore<span className="sr-only"> “{file.title}”</span>
    </Button>
  );
}
