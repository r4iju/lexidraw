"use client";

import { type FormEvent, useMemo, useState, useId } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { api } from "~/trpc/react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { revalidateDashboard } from "../server-actions";

type Props = {
  parentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function CreateUrlModal({
  parentId,
  open,
  onOpenChange,
}: Props) {
  const utils = api.useUtils();
  const [url, setUrl] = useState("");
  const urlId = useId();

  const isValidUrl = useMemo(() => {
    try {
      if (!url) return false;
      new URL(url.includes("://") ? url : `https://${url}`);
      return true;
    } catch {
      return false;
    }
  }, [url]);

  const normalizedUrl = useMemo(() => {
    if (!url) return "";
    return url.includes("://") ? url : `https://${url}`;
  }, [url]);

  const createMutation = api.entities.create.useMutation({
    onError(error) {
      toast.error("Couldn’t save the link. Try again.", {
        description: error.message,
      });
    },
  });

  const distillMutation = api.entities.distillUrl.useMutation({
    async onSuccess() {
      await utils.entities.list.invalidate({ parentId: parentId ?? undefined });
      toast.success("Saved the link and its text.");
      onOpenChange(false);
    },
    onError(error) {
      toast.error("Saved the link, but couldn’t read the page.", {
        description: error.message,
      });
    },
  });

  const isSaving = createMutation.isPending || distillMutation.isPending;

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidUrl || isSaving) return;
    const id = uuidv4();
    await createMutation.mutateAsync({
      id,
      title: "New link",
      entityType: "url",
      elements: JSON.stringify({ url: normalizedUrl }),
      parentId: parentId ?? null,
    });
    // Trigger distillation and let the mutation close the modal on success
    distillMutation.mutate(
      { id },
      {
        onSettled: async () => {
          await revalidateDashboard();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSave} className="contents">
          <DialogHeader>
            <DialogTitle>New link</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={urlId}>Web address</Label>
            <Input
              id={urlId}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/awesome"
              inputMode="url"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!isValidUrl || isSaving}>
              {isSaving ? "Saving..." : "Save link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
