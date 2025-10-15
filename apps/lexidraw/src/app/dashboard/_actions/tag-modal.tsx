"use client";

import React, { useState } from "react";
import { api } from "~/trpc/react";
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
import { ReloadIcon } from "@radix-ui/react-icons";
import { cn } from "~/lib/utils";
import { revalidateDashboard } from "../server-actions";
import { TagsInput } from "~/components/ui/tags-input";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const TagEntityModal = ({ entity, isOpen, onOpenChange }: Props) => {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(entity.tags || []);
  const { mutate: addTags } = api.entities.updateEntityTags.useMutation();
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = () => {
    setIsLoading(true);
    addTags(
      { entityId: entity.id, tagNames: tags },
      {
        onSuccess: async () => {
          await revalidateDashboard();
          router.refresh();
          toast.success("Saved!", {
            description: `Added tags: ${tags.join(", ")}`,
          });
          setIsLoading(false);
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(error.message);
          setIsLoading(false);
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg min-w-72">
        <DialogHeader>
          <DialogTitle>Edit tags</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="tags" className="text-right">
              Tags
            </Label>
            <div className="col-span-3">
              <TagsInput
                id="tags"
                value={tags}
                onChange={setTags}
                placeholder="Add tags..."
              />
            </div>
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
            <span>Save changes</span>
            <ReloadIcon className="w-0 opacity-0" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TagEntityModal;
