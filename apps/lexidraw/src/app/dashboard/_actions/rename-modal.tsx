"use client";

import React, { useState } from "react";
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
import { useToast } from "~/components/ui/toast-provider";
import { RouterOutputs } from "~/trpc/shared";
import { useRouter } from "next/navigation";
import { Label } from "~/components/ui/label";
import { ReloadIcon } from "@radix-ui/react-icons";
import { cn } from "~/lib/utils";
import { revalidateDashboard } from "../server-actions";

type Props = {
  className?: string;
  entity: RouterOutputs["entities"]["list"][number];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const RenameEntityModal = ({ entity, isOpen, onOpenChange }: Props) => {
  const router = useRouter();
  const [newTitle, setNewTitle] = useState(entity.title);
  const { toast } = useToast();
  const { mutate } = api.entities.update.useMutation();
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = () => {
    setIsLoading(true);
    mutate(
      { id: entity.id, title: newTitle },
      {
        onSuccess: async () => {
          await revalidateDashboard();
          router.refresh();
          toast({ title: "Saved!", description: newTitle });
          setIsLoading(false);
          onOpenChange(false);
        },
        onError: (error) => {
          toast({ title: error.message, variant: "destructive" });
          setIsLoading(false);
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg min-w-72">
        <DialogHeader>
          <DialogTitle>Edit name</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="title" className="text-right">
              Title
            </Label>
            <Input
              id="title"
              value={newTitle}
              className="col-span-3"
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isLoading}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={isLoading}
            type="submit"
            onClick={handleSave}
            className="flex items-center gap-2"
          >
            <ReloadIcon
              className={cn("w-0", isLoading && "animate-spin w-4")}
            />
            <span>Save title</span>
            <ReloadIcon className="w-0 opacity-0" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RenameEntityModal;
