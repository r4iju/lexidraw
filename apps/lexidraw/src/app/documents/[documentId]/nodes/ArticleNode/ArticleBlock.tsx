"use client";

import type { NodeKey } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import type * as React from "react";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import type { ArticleNodeData, ArticleDistilled } from "@packages/types";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import {
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
  StickyNote,
  Trash2,
} from "lucide-react";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $insertNodes,
  $isElementNode,
} from "lexical";
import {
  htmlToPlainText,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
} from "@packages/lexical-nodes";
import { EmbedFallback } from "../common/embed";
import { ArticleNode } from "./ArticleNode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "~/components/ui/dialog";

export function ArticleBlock({
  className,
  nodeKey,
  data,
}: {
  className: { base: string; focus: string };
  nodeKey: NodeKey;
  data: ArticleNodeData;
}) {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isSelected] = useLexicalNodeSelection(nodeKey);

  const distilled = data.mode === "url" ? data.distilled : data.snapshot;

  const entityId = data.mode === "entity" ? data.entityId : undefined;
  const entityQuery = api.entities.load.useQuery(
    { id: entityId ?? "" },
    { enabled: Boolean(entityId) },
  );
  const extractMutation = api.articles.extractFromUrl.useMutation();

  const saved = useMemo(
    () =>
      data.mode === "entity"
        ? parseSavedLink(entityQuery.data?.elements)
        : undefined,
    [data.mode, entityQuery.data?.elements],
  );
  const latestDistilled: CardFields | undefined = saved?.distilled ?? distilled;
  const missing = data.mode === "entity" && entityQuery.isError;

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (data.mode === "url") {
        const originalUrl = data.url;
        const nextRaw = await extractMutation.mutateAsync({ url: originalUrl });
        if (nextRaw?.contentHtml) {
          const next: ArticleDistilled = {
            title: nextRaw.title || originalUrl,
            contentHtml: nextRaw.contentHtml,
            byline: nextRaw.byline ?? null,
            siteName: nextRaw.siteName ?? null,
            wordCount: nextRaw.wordCount ?? null,
            excerpt: nextRaw.excerpt ?? null,
            bestImageUrl: nextRaw.bestImageUrl ?? null,
            datePublished: nextRaw.datePublished ?? null,
            updatedAt: nextRaw.updatedAt ?? new Date().toISOString(),
          };
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            if (ArticleNode.$isArticleNode(node)) {
              node.setData({ mode: "url", url: originalUrl, distilled: next });
            }
          });
        }
      } else if (data.mode === "entity") {
        await entityQuery.refetch();
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [data, editor, entityQuery, nodeKey, extractMutation]);

  const convertToText = useCallback(() => {
    const html = latestDistilled?.contentHtml;
    if (!html) return;
    void (async () => {
      setIsConverting(true);
      try {
        const { $generateNodesFromDOM } = await import("@lexical/html");
        editor.update(() => {
          const parser = new DOMParser();
          const dom = parser.parseFromString(html, "text/html");
          let nodes = $generateNodesFromDOM(editor, dom);
          // Sanitize: unwrap disallowed shadow nodes (collapsible elements) before insertion
          const unwrapUnsupported = (arr: typeof nodes): typeof nodes => {
            const out: typeof nodes = [];
            for (const n of arr) {
              if (
                CollapsibleContainerNode.$isCollapsibleContainerNode(n) ||
                CollapsibleContentNode.$isCollapsibleContentNode(n) ||
                CollapsibleTitleNode.$isCollapsibleTitleNode(n)
              ) {
                if ($isElementNode(n)) {
                  out.push(...n.getChildren());
                }
              } else {
                out.push(n);
              }
            }
            return out;
          };
          nodes = unwrapUnsupported(nodes);
          if (nodes.length === 0) {
            const p = $createParagraphNode();
            p.append($createTextNode(htmlToPlainText(html)));
            nodes = [p];
          }
          const node = $getNodeByKey(nodeKey);
          if (!ArticleNode.$isArticleNode(node)) return;
          let containerAncestor: typeof node | CollapsibleContainerNode | null =
            null;
          let parent = node.getParent();
          while (parent) {
            if (CollapsibleContainerNode.$isCollapsibleContainerNode(parent)) {
              containerAncestor = parent;
              break;
            }
            parent = parent.getParent();
          }
          if (containerAncestor) {
            containerAncestor.selectNext();
          } else {
            node.selectNext();
          }
          $insertNodes(nodes);
          const last = nodes[nodes.length - 1];
          if (last && $isElementNode(last)) {
            last.selectEnd();
          }
          node.remove();
        });
      } catch {
        // Fallback: plain-text paragraphs
        const text = htmlToPlainText(html);
        const paragraphs = text
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
        if (paragraphs.length === 0) return;
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (!ArticleNode.$isArticleNode(node)) return;
          const toInsert = paragraphs.map((p) => {
            const pNode = $createParagraphNode();
            pNode.append($createTextNode(p));
            return pNode;
          });
          let containerAncestor: typeof node | CollapsibleContainerNode | null =
            null;
          let parent = node.getParent();
          while (parent) {
            if (CollapsibleContainerNode.$isCollapsibleContainerNode(parent)) {
              containerAncestor = parent;
              break;
            }
            parent = parent.getParent();
          }
          if (containerAncestor) {
            containerAncestor.selectNext();
          } else {
            node.selectNext();
          }
          $insertNodes(toInsert);
          const last = toInsert[toInsert.length - 1];
          if (last) {
            last.selectEnd();
          }
          node.remove();
        });
      } finally {
        setIsConverting(false);
      }
    })();
  }, [editor, latestDistilled, nodeKey]);

  const handleRemoveNode = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (ArticleNode.$isArticleNode(node)) {
        node.remove();
      }
    });
    setIsDeleteOpen(false);
  }, [editor, nodeKey]);

  const toolbar = isEditable && (
    <div
      role="toolbar"
      aria-label="Link"
      className={cn(
        "absolute top-2 right-2 z-10 flex gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-sm transition-opacity print:hidden",
        "opacity-0 group-hover/article:opacity-100 group-focus-within/article:opacity-100 pointer-coarse:opacity-100",
        isSelected && "opacity-100",
      )}
    >
      {!missing && (
        <>
          <ToolbarButton
            label="Refresh"
            onClick={refresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={cn("size-4", isRefreshing && "animate-spin")}
            />
          </ToolbarButton>
          <ToolbarButton
            label="Convert to text"
            onClick={convertToText}
            disabled={isConverting || !latestDistilled?.contentHtml}
          >
            {isConverting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <StickyNote className="size-4" />
            )}
          </ToolbarButton>
        </>
      )}
      <ToolbarButton label="Remove" onClick={() => setIsDeleteOpen(true)}>
        <Trash2 className="size-4" />
      </ToolbarButton>
    </div>
  );

  const url = data.mode === "url" ? data.url : saved?.url;
  const card = {
    title: latestDistilled?.title || url || "Saved link",
    description:
      latestDistilled?.excerpt?.trim() ||
      htmlToPlainText(latestDistilled?.contentHtml ?? "")
        .slice(0, 300)
        .replace(/\s+/g, " ")
        .trim(),
    site: siteOf(url) ?? latestDistilled?.siteName ?? undefined,
    image: latestDistilled?.bestImageUrl ?? undefined,
  };

  return (
    <div
      className={cn(
        "group/article relative my-2 w-full",
        className.base,
        isSelected && className.focus,
      )}
    >
      {missing ? (
        <EmbedFallback
          icon={<Link2Off />}
          message="This saved link is missing"
        />
      ) : data.mode === "entity" ? (
        // The iOS app's generated WebArticleData reads this route's shape.
        <BookmarkCard {...card} href={`/urls/${data.entityId}`} />
      ) : (
        <BookmarkCard {...card} href={data.url} />
      )}
      {toolbar}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Remove this link block?</DialogTitle>
            <DialogDescription>
              This only removes the block from the document. The saved link
              stays in your files.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive-confirm"
              type="button"
              onClick={handleRemoveNode}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A saved page as Notion shows a bookmark: what it is, where, and its picture. */
function BookmarkCard({
  href,
  title,
  description,
  site,
  image,
}: {
  href: string;
  title: string;
  description: string;
  site: string | undefined;
  image: string | undefined;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="document-embed flex min-h-26 text-left text-inherit no-underline transition-colors hover:bg-muted/50"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1 px-4 py-3">
        <span className="truncate text-sm font-medium text-foreground">
          {title}
        </span>
        {description && (
          <span className="line-clamp-2 text-xs leading-normal text-muted-foreground">
            {description}
          </span>
        )}
        {site && (
          <span className="mt-auto flex min-w-0 items-center gap-1.5 pt-1 text-xs text-foreground/80">
            <Link2 aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{site}</span>
          </span>
        )}
      </span>
      {image && (
        <span className="relative w-[30%] max-w-60 min-w-24 shrink-0 border-border border-l">
          <img
            src={image}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        </span>
      )}
    </a>
  );
}

function ToolbarButton({
  label,
  children,
  ...props
}: { label: string } & Omit<React.ComponentProps<"button">, "aria-label">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 pointer-coarse:size-9"
      onMouseDown={(event) => event.preventDefault()}
      {...props}
    >
      {children}
    </button>
  );
}

/** What a card shows of a saved page. */
type CardFields = z.infer<typeof CardFields>;
const CardFields = z.object({
  title: z.string().optional().catch(undefined),
  siteName: z.string().nullish().catch(undefined),
  excerpt: z.string().nullish().catch(undefined),
  bestImageUrl: z.string().nullish().catch(undefined),
  contentHtml: z.string().optional().catch(undefined),
  updatedAt: z.string().optional().catch(undefined),
});

/**
 * A saved link entity's `elements`, which its owner can fill with anything:
 * a field that does not fit is left out rather than failing the card.
 */
const SavedLink = z
  .object({
    url: z.string().optional().catch(undefined),
    distilled: CardFields.optional().catch(undefined),
  })
  .catch({});

function parseSavedLink(elements: string | null | undefined) {
  try {
    return SavedLink.parse(JSON.parse(elements || "{}"));
  } catch {
    return SavedLink.parse(undefined);
  }
}

/** The site a page is on, as a card names it: its host without `www.`. */
function siteOf(url: string | undefined): string | undefined {
  if (!url || !URL.canParse(url)) return undefined;
  return new URL(url).hostname.replace(/^www\./, "");
}
