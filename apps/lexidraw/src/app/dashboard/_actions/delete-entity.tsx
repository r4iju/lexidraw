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
import { useToast } from "~/components/ui/toast-provider";
import { api } from "~/trpc/react";
import { RouterOutputs } from "~/trpc/shared";
import { revalidateDashboard } from "../server-actions";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

export default function DeleteDrawing({ entity, isOpen, onOpenChange }: Props) {
  const router = useRouter();
  const { mutate: remove, isPending } = api.entities.delete.useMutation();
  const { toast } = useToast();

  const handleDelete = () => {
    remove(
      { id: entity.id },
      {
        onSuccess: async () => {
          toast({ title: "Removed!" });
          await revalidateDashboard();
          router.refresh();
        },
        onError: (error) => {
          toast({
            title: "Removed!",
            description: error.message,
            variant: "destructive",
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
          <DialogClose asChild>
            <Button
              variant="destructive"
              type="button"
              onClick={handleDelete}
              disabled={isPending}
            >
              Delete
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
