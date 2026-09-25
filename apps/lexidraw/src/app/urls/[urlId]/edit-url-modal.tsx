"use client";

import { type FormEvent, useEffect, useMemo, useState, useId } from "react";
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

  const [url, setUrl] = useState(initialUrl);
  const urlId = useId();

  useEffect(() => {
    setUrl(initialUrl);
  }, [initialUrl]);

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
      toast.success(`Saved “${entity.title}”.`);
      await utils.entities.load.invalidate({ id: entity.id });
      onOpenChange(false);
    },
    onError(error) {
      toast.error("Couldn’t save the link. Try again.", {
        description: error.message,
      });
    },
  });

  const distillMutation = api.entities.distillUrl.useMutation({
    async onSuccess() {
      toast.success("Saved the link and its text.");
      await utils.entities.load.invalidate({ id: entity.id });
      onOpenChange(false);
    },
    onError(error) {
      toast.error("Saved the link, but couldn’t read the page.", {
        description: error.message,
      });
    },
  });

  const normalizedUrl = useMemo(() => {
    if (!url) return "";
    return url.includes("://") ? url : `https://${url}`;
  }, [url]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!isValidUrl || saveMutation.isPending) return;
    saveMutation.mutate({
      id: entity.id,
      elements: JSON.stringify({ url: normalizedUrl }),
      entityType: "url",
      // A link carries no editor state.
      appState: null,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="contents">
          <DialogHeader>
            <DialogTitle>Edit link</DialogTitle>
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => distillMutation.mutate({ id: entity.id })}
              disabled={!isValidUrl || distillMutation.isPending}
            >
              {distillMutation.isPending ? "Getting..." : "Get"}
            </Button>
            <Button
              type="submit"
              disabled={saveMutation.isPending || !isValidUrl}
            >
              {saveMutation.isPending ? "Saving..." : "Save link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
