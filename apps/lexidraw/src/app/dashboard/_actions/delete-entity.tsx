"use client";

import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { revalidateDashboard } from "../server-actions";
import { toast } from "sonner";

type Props = {
  entity:
    | RouterOutputs["entities"]["list"][number]
    | { id: string; entityType: string; title: string };
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

export default function DeleteEntity({ entity, isOpen, onOpenChange }: Props) {
  const router = useRouter();
  const { mutate: remove, isPending } = api.entities.delete.useMutation();
  const { data: metadata } = api.entities.getMetadata.useQuery({
    id: entity.id,
  });

  const handleDelete = () => {
    remove(
      { id: entity.id },
      {
        onSuccess: async () => {
          await revalidateDashboard();
          const afterDeleteHref = metadata?.parentId
            ? `/dashboard/${metadata.parentId}`
            : "/dashboard";
          router.replace(afterDeleteHref);
          toast.success(`Deleted “${entity.title}”.`);
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(`Couldn’t delete “${entity.title}”. Try again.`, {
            description: error.message,
          });
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-72 break-normal sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-8 leading-snug">
            Delete “{entity.title}”?
          </DialogTitle>
          <DialogDescription>
            It’s removed for everyone it’s shared with. You can’t undo this.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive-confirm"
            type="button"
            onClick={handleDelete}
            disabled={isPending}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
