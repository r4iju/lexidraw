import type { ElementFormatType } from "lexical";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/** The side of the column an embed narrower than the column sits at. */
export type EmbedAlign = "left" | "center" | "right";

export function embedAlign(format: ElementFormatType | null): EmbedAlign {
  if (format === "left" || format === "start") return "left";
  if (format === "right" || format === "end") return "right";
  return "center";
}

/**
 * Places a box narrower than its block at its side. The block's own
 * `text-align` only moves inline content, not a sized box.
 */
export const ALIGN_MARGINS: Record<EmbedAlign, string> = {
  left: "mr-auto",
  center: "mx-auto",
  right: "ml-auto",
};

/** Where an embed's source can be opened, as its card names it. */
export type EmbedSource = { href: string; label: string };

export function SourceLink({
  source,
  className,
}: {
  source: EmbedSource;
  className?: string;
}) {
  return (
    <a
      href={source.href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline",
        className,
      )}
    >
      {source.label}
      <ExternalLink aria-hidden className="size-3.5" />
    </a>
  );
}

/**
 * What an embed shows when it has nothing to show: a compact card saying
 * why, with its source a click away when there is one.
 */
export function EmbedFallback({
  icon,
  message,
  source,
  className,
}: {
  icon: ReactNode;
  message: string;
  /** Left out when nothing is linked. */
  source?: EmbedSource;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "document-embed flex items-center gap-3 px-4 py-3 text-left text-sm text-muted-foreground print:hidden",
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-medium text-foreground">{message}</div>
        {source && <SourceLink source={source} />}
      </div>
    </div>
  );
}

/** Covers an embed's box while it loads, so the page never shows a blank frame. */
export function EmbedLoading({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 animate-skeleton bg-muted",
        className,
      )}
    />
  );
}
