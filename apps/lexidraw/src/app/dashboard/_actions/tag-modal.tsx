"use client";

import { type FormEvent, useState, useEffect, useMemo } from "react";
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
import { revalidateDashboard } from "../server-actions";
import { TagsInput } from "~/components/ui/tags-input";

type EntityWithTags = RouterOutputs["entities"]["list"][number];
type EntityWithId = { id: string; tags?: string[] };

type Props =
  | {
      entity: EntityWithTags;
      isOpen: boolean;
      onOpenChange: (open: boolean) => void;
      onSuccess?: () => Promise<void>;
    }
  | {
      entity: EntityWithId;
      isOpen: boolean;
      onOpenChange: (open: boolean) => void;
      onSuccess?: () => Promise<void>;
    };

const TagEntityModal = (props: Props) => {
  const { isOpen, onOpenChange, onSuccess } = props;
  const router = useRouter();
  const entityId = props.entity.id;
  const initialTags =
    "tags" in props.entity ? props.entity.tags || [] : undefined;

  // Fetch tags if not provided
  const { data: fetchedTags } = api.entities.getEntityTags.useQuery(
    { id: entityId },
    {
      enabled: isOpen && initialTags === undefined,
    },
  );

  const currentTags = useMemo(() => {
    return initialTags ?? fetchedTags ?? [];
  }, [initialTags, fetchedTags]);

  const [tags, setTags] = useState<string[]>(currentTags);
  const { mutate: addTags } = api.entities.updateEntityTags.useMutation();
  const [isLoading, setIsLoading] = useState(false);

  // Update tags when fetched or when modal opens
  useEffect(() => {
    if (isOpen) {
      setTags(currentTags);
    }
  }, [isOpen, currentTags]);

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    addTags(
      { id: entityId, tagNames: tags },
      {
        onSuccess: async () => {
          if (onSuccess) {
            await onSuccess();
          } else {
            await revalidateDashboard();
            router.refresh();
          }
          toast.success(
            "title" in props.entity
              ? `Updated the tags on “${props.entity.title}”.`
              : "Updated the tags.",
          );
          setIsLoading(false);
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error("Couldn’t update the tags. Try again.", {
            description: error.message,
          });
          setIsLoading(false);
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSave} className="contents">
          <DialogHeader>
            <DialogTitle>Edit tags</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor={`tags-input-${entityId}`} className="text-right">
                Tags
              </Label>
              <div className="col-span-3">
                <TagsInput
                  id={`tags-input-${entityId}`}
                  value={tags}
                  onChange={setTags}
                  placeholder="Add tags..."
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={isLoading}>
                Cancel
              </Button>
            </DialogClose>
            <Button disabled={isLoading} type="submit" pending={isLoading}>
              Save tags
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TagEntityModal;
