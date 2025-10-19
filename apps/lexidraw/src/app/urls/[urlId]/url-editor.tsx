"use client";

import { useId, useMemo, useState } from "react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import type { RouterOutputs } from "~/trpc/shared";
import { api } from "~/trpc/react";
import { toast } from "sonner";
import Link from "next/link";
import ArticlePreview from "./ArticlePreview";

type Props = {
  entity: RouterOutputs["entities"]["load"]; // from server page
};

export default function UrlEditor({ entity }: Props) {
  const initial = useMemo(() => {
    try {
      const parsed = JSON.parse(entity.elements ?? "{}") as { url?: string };
      return parsed.url ?? "";
    } catch {
      return "";
    }
  }, [entity.elements]);

  const [title, setTitle] = useState(entity.title ?? "");
  const [url, setUrl] = useState(initial);
  const titleId = useId();
  const urlId = useId();

  const saveMutation = api.entities.save.useMutation({
    onSuccess() {
      toast.success("Saved link");
    },
    onError(error) {
      toast.error("Failed to save", { description: error.message });
    },
  });

  const distillMutation = api.entities.distillUrl.useMutation({
    onSuccess() {
      toast.success("Article distilled");
    },
    onError(error) {
      toast.error("Failed to distill", { description: error.message });
    },
  });

  const isValidUrl = useMemo(() => {
    try {
      if (!url) return false;
      // Allow missing protocol by trying to prefix https://
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

  return (
    // scrollable container
    <div className="overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">Edit link</h1>
          {isValidUrl && (
            <Button asChild variant="secondary">
              <Link
                href={normalizedUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open link
              </Link>
            </Button>
          )}
        </div>

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

          <div className="pt-2">
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  saveMutation.mutate({
                    id: entity.id,
                    title,
                    elements: JSON.stringify({ url }),
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
                {distillMutation.isPending
                  ? "Distilling..."
                  : "Distill article"}
              </Button>
            </div>
          </div>

          <ArticlePreview entity={entity} />
        </div>
      </div>
    </div>
  );
}
