import { BlockWithAlignableContents } from "@lexical/react/LexicalBlockWithAlignableContents";
import { mediaLink } from "@packages/lexical-nodes/media-links";
import type { ElementFormatType, NodeKey } from "lexical";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { TwitterIcon } from "~/components/icons/twitter";
import { cn } from "~/lib/utils";
import {
  ALIGN_MARGINS,
  EmbedFallback,
  EmbedLoading,
  embedAlign,
} from "./common/embed";
import { PrintedLink } from "./common/PrintedLink";

const WIDGET_SCRIPT_URL = "https://platform.twitter.com/widgets.js";
/** How long X gets to draw a post before the block stops waiting. */
const WIDGET_TIMEOUT_MS = 15_000;

/** The part of X's widget script the block uses. */
type Widgets = {
  createTweet: (
    id: string,
    into: HTMLElement,
    options: { theme: "light" | "dark" },
  ) => Promise<HTMLElement | undefined>;
};

let widgetScript: Promise<Widgets> | undefined;

/** X's widgets, loading its script the first time any post asks. */
function loadWidgets(): Promise<Widgets> {
  const loaded = () =>
    (window as unknown as { twttr?: { widgets?: Widgets } }).twttr?.widgets;
  const ready = loaded();
  if (ready) return Promise.resolve(ready);
  widgetScript ??= new Promise<Widgets>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = WIDGET_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const widgets = loaded();
      if (widgets) resolve(widgets);
      else reject(new Error("X's widget script loaded without its widgets"));
    };
    script.onerror = () => reject(new Error("X's widget script failed"));
    document.body.append(script);
  }).catch((error: unknown) => {
    // A later post tries again rather than inheriting the failure.
    widgetScript = undefined;
    throw error;
  });
  return widgetScript;
}

type TweetComponentProps = Readonly<{
  className: Readonly<{
    base: string;
    focus: string;
  }>;
  format: ElementFormatType | null;
  nodeKey: NodeKey;
  tweetID: string;
}>;

export default function TweetComponent({
  className,
  format,
  nodeKey,
  tweetID,
}: TweetComponentProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { resolvedTheme, forcedTheme } = useTheme();
  const theme = (forcedTheme ?? resolvedTheme) === "dark" ? "dark" : "light";
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const href = mediaLink("tweet", tweetID);

  // X's widget script draws the post into the container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !href) return;
    let current = true;
    setStatus("loading");
    // Each attempt draws into its own element, so a superseded one that
    // finishes late lands outside the page.
    const target = document.createElement("div");
    container.replaceChildren(target);
    const timeout = new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), WIDGET_TIMEOUT_MS),
    );
    Promise.race([
      loadWidgets().then((widgets) =>
        widgets.createTweet(tweetID, target, { theme }),
      ),
      timeout,
    ])
      .catch(() => undefined)
      .then((post) => {
        if (!current) return;
        if (!post) target.remove();
        setStatus(post ? "ready" : "unavailable");
      });
    return () => {
      current = false;
      target.remove();
    };
  }, [href, tweetID, theme]);

  const align = embedAlign(format);
  if (!href)
    return (
      <BlockWithAlignableContents
        className={className}
        format={format}
        nodeKey={nodeKey}
      >
        <EmbedFallback icon={<TwitterIcon />} message="No post linked" />
      </BlockWithAlignableContents>
    );
  return (
    <BlockWithAlignableContents
      className={className}
      format={format}
      nodeKey={nodeKey}
    >
      {status === "unavailable" && (
        <EmbedFallback
          icon={<TwitterIcon />}
          message="This post is unavailable"
          source={{ href, label: "Open on X" }}
        />
      )}
      <div
        data-embed-align={align}
        aria-busy={status === "loading" || undefined}
        className={cn(
          "relative w-full max-w-[550px] print:hidden",
          ALIGN_MARGINS[align],
          // The bordered box also gives the block the column's width while
          // there is no frame in it yet.
          { "document-embed h-60": status === "loading" },
          { hidden: status === "unavailable" },
        )}
      >
        {status === "loading" && <EmbedLoading />}
        <div
          ref={containerRef}
          className="[&_.twitter-tweet]:my-0!"
          style={{ colorScheme: "normal" }}
        />
      </div>
      <PrintedLink href={href} />
    </BlockWithAlignableContents>
  );
}
