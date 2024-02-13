"use client";

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
import { useToast } from "~/components/ui/use-toast";
import { api } from "~/trpc/react";

type Props = {
  drawingId: string;
  revalidatePath: VoidFunction;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

export default function DeleteDrawing({
  drawingId,
  revalidatePath,
  isOpen,
  onOpenChange,
}: Props) {
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
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
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
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              variant="default"
              type="button"
              onClick={handleDelete}
              disabled={isLoading}
            >
              Delete
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
