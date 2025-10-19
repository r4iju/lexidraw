"use client";

import { useEffect, useMemo, useState, useId } from "react";
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
import type { RouterOutputs } from "~/trpc/shared";
import { api } from "~/trpc/react";
import { toast } from "sonner";

type Props = {
  entity: RouterOutputs["entities"]["load"];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function EditUrlModal({ entity, isOpen, onOpenChange }: Props) {
  const utils = api.useUtils();
  const initialUrl = useMemo(() => {
    try {
      const parsed = JSON.parse(entity.elements ?? "{}") as { url?: string };
      return parsed.url ?? "";
    } catch {
      return "";
    }
  }, [entity.elements]);

  const [title, setTitle] = useState(entity.title ?? "");
  const [url, setUrl] = useState(initialUrl);
  const titleId = useId();
  const urlId = useId();

  useEffect(() => {
    setTitle(entity.title ?? "");
    setUrl(initialUrl);
  }, [entity.title, initialUrl]);

  const isValidUrl = useMemo(() => {
    try {
      if (!url) return false;
      new URL(url.includes("://") ? url : `https://${url}`);
      return true;
    } catch {
      return false;
    }
  }, [url]);

  const saveMutation = api.entities.save.useMutation({
    onSuccess: async () => {
      toast.success("Saved link");
      await utils.entities.load.invalidate({ id: entity.id });
      onOpenChange(false);
    },
    onError(error) {
      toast.error("Failed to save", { description: error.message });
    },
  });

  const distillMutation = api.entities.distillUrl.useMutation({
    async onSuccess() {
      toast.success("Article distilled");
      await utils.entities.load.invalidate({ id: entity.id });
      onOpenChange(false);
    },
    onError(error) {
      toast.error("Failed to distill", { description: error.message });
    },
  });

  const normalizedUrl = useMemo(() => {
    if (!url) return "";
    return url.includes("://") ? url : `https://${url}`;
  }, [url]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit link</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor={titleId}>Title</Label>
            <Input
              id={titleId}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My favorite article"
            />
          </div>

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
              onClick={() =>
                saveMutation.mutate({
                  id: entity.id,
                  title,
                  elements: JSON.stringify({ url: normalizedUrl }),
                  entityType: "url",
                })
              }
              disabled={saveMutation.isPending || !isValidUrl}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => distillMutation.mutate({ id: entity.id })}
              disabled={!isValidUrl || distillMutation.isPending}
            >
              {distillMutation.isPending ? "Distilling..." : "Distill article"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
