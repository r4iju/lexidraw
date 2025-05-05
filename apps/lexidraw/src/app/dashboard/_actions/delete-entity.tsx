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
import { RouterOutputs } from "~/trpc/shared";
import { revalidateDashboard } from "../server-actions";
import { toast } from "sonner";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

export default function DeleteDrawing({ entity, isOpen, onOpenChange }: Props) {
  const router = useRouter();
  const { mutate: remove, isPending } = api.entities.delete.useMutation();

  const handleDelete = () => {
    remove(
      { id: entity.id },
      {
        onSuccess: async () => {
          await revalidateDashboard();
          router.refresh();
          toast.success("Removed!");
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error("Something went wrong!", {
            description: error.message,
          });
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-72 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Deletion</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this {entity.entityType}? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
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
