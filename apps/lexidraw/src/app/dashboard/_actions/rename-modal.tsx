"use client";

import { type FormEvent, useState } from "react";
import { api } from "~/trpc/react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "~/components/ui/dialog";
import { toast } from "sonner";
import type { RouterOutputs } from "~/trpc/shared";
import { useRouter } from "next/navigation";
import { Label } from "~/components/ui/label";
import { revalidateDashboard } from "../server-actions";

type Props = {
  className?: string;
  entity:
    | RouterOutputs["entities"]["list"][number]
    | { id: string; title: string };
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const RenameEntityModal = ({ entity, isOpen, onOpenChange }: Props) => {
  const router = useRouter();
  const [newTitle, setNewTitle] = useState(entity.title);
  const { mutate } = api.entities.update.useMutation();
  const [isLoading, setIsLoading] = useState(false);

  const canRename = newTitle.trim() !== "" && !isLoading;

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    if (!canRename) return;
    setIsLoading(true);
    mutate(
      { id: entity.id, title: newTitle },
      {
        onSuccess: async () => {
          await revalidateDashboard();
          router.refresh();
          toast.success(`Renamed to “${newTitle}”.`);
          setIsLoading(false);
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(`Couldn’t rename “${entity.title}”. Try again.`, {
            description: error.message,
          });
          setIsLoading(false);
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={handleSave} className="contents">
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label
                htmlFor={`rename-title-${entity.id}`}
                className="text-right"
              >
                Title
              </Label>
              <Input
                id={`rename-title-${entity.id}`}
                value={newTitle}
                className="col-span-3"
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={isLoading}>
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={!canRename} type="submit" pending={isLoading}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RenameEntityModal;
