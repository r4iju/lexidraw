"use client";

import { useMemo, useState } from "react";
import type { RouterOutputs } from "~/trpc/shared";
import UrlHeader from "./url-header";
import EditUrlModal from "./edit-url-modal";
import ArticlePreview from "./ArticlePreview";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

type Props = {
  entity: RouterOutputs["entities"]["load"];
  preferredPlaybackRate?: number;
};

export default function UrlViewer({ entity, preferredPlaybackRate }: Props) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [width, setWidth] = useState<"narrow" | "medium" | "wide">("medium");
  const url = useMemo(() => {
    try {
      const parsed = JSON.parse(entity.elements ?? "{}") as { url?: string };
      return parsed.url ?? "";
    } catch {
      return "";
    }
  }, [entity.elements]);

  const openEdit = () => setIsEditOpen(true);

  return (
    <div className="w-full relative overflow-y-auto">
      <UrlHeader
        entity={entity}
        onChangeUrl={openEdit}
        className="sticky top-0 z-10 bg-background"
        width={width}
        onWidthChange={setWidth}
      />

      {!url ? (
        <div className="rounded-md border border-border p-6">
          <div className="mb-2 text-lg font-medium">No article yet</div>
          <div className="text-muted-foreground mb-4">
            Add a URL to distill and read it here.
          </div>
          <Button onClick={openEdit}>Add article</Button>
        </div>
      ) : (
        <div
          className={cn("w-full mx-auto", {
            "mx-auto max-w-lg": width === "narrow",
            "mx-auto max-w-2xl": width === "medium",
            "mx-auto max-w-4xl": width === "wide",
          })}
        >
          <ArticlePreview
            entity={entity}
            preferredPlaybackRate={preferredPlaybackRate}
          />
        </div>
      )}

      <EditUrlModal
        entity={entity}
        isOpen={isEditOpen}
        onOpenChange={setIsEditOpen}
      />
    </div>
  );
}
