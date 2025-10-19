"use client";

import { useMemo, useState, useId } from "react";
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

type Props = {
  parentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function CreateUrlModal({ parentId, open, onOpenChange }: Props) {
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
      toast.error("Failed to create link", { description: error.message });
    },
  });

  const distillMutation = api.entities.distillUrl.useMutation({
    async onSuccess() {
      await utils.entities.list.invalidate({ parentId: parentId ?? null });
      toast.success("Article distilled");
      onOpenChange(false);
    },
    onError(error) {
      toast.error("Failed to distill", { description: error.message });
    },
  });

  const handleSave = async () => {
    const id = uuidv4();
    await createMutation.mutateAsync({
      id,
      title: "New link",
      entityType: "url",
      elements: JSON.stringify({ url: normalizedUrl }),
      parentId: parentId ?? null,
    });
    await utils.entities.list.invalidate({ parentId: parentId ?? null });
    toast.success("Saved link");
    onOpenChange(false);
  };

  const handleGet = async () => {
    const id = uuidv4();
    await createMutation.mutateAsync({
      id,
      title: "New link",
      entityType: "url",
      elements: JSON.stringify({ url: normalizedUrl }),
      parentId: parentId ?? null,
    });
    // Trigger distillation and let the mutation close the modal on success
    distillMutation.mutate({ id });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New link</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor={urlId}>URL</Label>
            <Input
              id={urlId}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/awesome"
              inputMode="url"
            />
          </div>
        </div>
        <DialogFooter className="justify-between">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={!isValidUrl || createMutation.isPending}
            >
              {createMutation.isPending ? "Saving..." : "Save"}
            </Button>
            <Button
              variant="secondary"
              onClick={handleGet}
              disabled={
                !isValidUrl || createMutation.isPending || distillMutation.isPending
              }
            >
              {distillMutation.isPending ? "Getting..." : "Get"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
