"use client";

import { useMemo } from "react";
import type { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["load"];
};

export default function ArticlePreview({ entity }: Props) {
  const distilled = useMemo(() => {
    try {
      const parsed = JSON.parse(entity.elements ?? "{}") as {
        distilled?: {
          title?: string;
          byline?: string | null;
          siteName?: string | null;
          wordCount?: number | null;
          updatedAt?: string;
          contentHtml?: string;
        };
      };
      return parsed.distilled;
    } catch {
      return undefined;
    }
  }, [entity.elements]);

  if (!distilled || !distilled.contentHtml) {
    return null;
  }

  return (
    <div className="w-full space-y-3 md:border-x md:border-border p-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-lg font-semibold">
            {distilled.title || entity.title}
          </div>
          <div className="text-muted-foreground text-sm">
            {distilled.byline ? `${distilled.byline} · ` : ""}
            {distilled.siteName || ""}
            {distilled.wordCount ? ` · ${distilled.wordCount} words` : ""}
            {distilled.updatedAt
              ? ` · ${new Date(distilled.updatedAt).toLocaleString()}`
              : ""}
          </div>
        </div>
      </div>
      <div className="prose max-w-none dark:prose-invert">
        <div
          // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized on the server before persisting
          dangerouslySetInnerHTML={{ __html: distilled.contentHtml ?? "" }}
        />
      </div>
    </div>
  );
}
