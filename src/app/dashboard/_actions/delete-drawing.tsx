"use client";

import { TrashIcon } from "@radix-ui/react-icons";
import { Button } from "~/components/ui/button";
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
import { useToast } from "~/components/ui/use-toast";
import { api } from "~/trpc/react";

type Props = {
  drawingId: string;
  revalidatePath: VoidFunction;
};

export default function DeleteDrawing({ drawingId, revalidatePath }: Props) {
  const { mutate: remove, isLoading } = api.drawings.delete.useMutation();
  const { toast } = useToast();

  const handleDelete = () => {
    remove(
      { id: drawingId },
      {
        onSuccess: () => {
          toast({ title: "Removed!" });
          revalidatePath();
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
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={isLoading}>
          <TrashIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Deletion</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this drawing? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex justify-end space-x-4">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="outline" type="button" onClick={handleDelete} disabled={isLoading}>
              Delete
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
