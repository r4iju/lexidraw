"use client";

import type { NodeKey } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useMemo, useState } from "react";
import type { ArticleNodeData, ArticleDistilled } from "@packages/types";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import {
  ExternalLink,
  RefreshCw,
  StickyNote,
  Trash2,
  Loader2,
} from "lucide-react";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $insertNodes,
  $isElementNode,
} from "lexical";
import { htmlToPlainText } from "~/lib/html-to-text";
import { ArticleNode } from "./ArticleNode";
import { CollapsibleContainerNode } from "../../plugins/CollapsiblePlugin/CollapsibleContainerNode";
import { CollapsibleContentNode } from "../../plugins/CollapsiblePlugin/CollapsibleContentNode";
import { CollapsibleTitleNode } from "../../plugins/CollapsiblePlugin/CollapsibleTitleNode";
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const distilled = useMemo(() => {
    if (data.mode === "url") return data.distilled;
    return data.snapshot; // live render uses fetch below; snapshot for initial paint
  }, [data]);

  const entityId = data.mode === "entity" ? data.entityId : undefined;
  const entityQuery = api.entities.load.useQuery(
    { id: entityId as string },
    { enabled: Boolean(entityId) },
  );
  const extractMutation = api.articles.extractFromUrl.useMutation();

  const latestDistilled = useMemo(():
    | {
        title?: string;
        byline?: string | null;
        siteName?: string | null;
        wordCount?: number | null;
        updatedAt?: string;
        contentHtml?: string;
      }
    | undefined => {
    if (data.mode !== "entity") return distilled;
    try {
      const json = JSON.parse(entityQuery.data?.elements ?? "{}") as {
        distilled?: {
          title?: string;
          byline?: string | null;
          siteName?: string | null;
          wordCount?: number | null;
          updatedAt?: string;
          contentHtml?: string;
        };
      };
      return json.distilled ?? distilled;
    } catch {
      return distilled;
    }
  }, [data.mode, entityQuery.data?.elements, distilled]);

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

  if (data.mode === "entity" && entityQuery.isError) {
    return (
      <div className="border border-dashed border-border rounded-md p-3 text-muted-foreground">
        Article not found. You can remove this block.
      </div>
    );
  }

  const title = latestDistilled?.title;
  const byline = latestDistilled?.byline ?? undefined;
  const siteName = latestDistilled?.siteName ?? undefined;
  const wordCount = latestDistilled?.wordCount ?? undefined;
  const updatedAt = latestDistilled?.updatedAt ?? undefined;

  return (
    <div className={cn("my-2", className.base)}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">
            {title || (data.mode === "url" ? data.url : "Article")}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {byline ? `${byline} · ` : ""}
            {siteName || ""}
            {wordCount ? ` · ${wordCount} words` : ""}
            {updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {data.mode === "entity" ? (
            <a
              href={`/urls/${data.entityId}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-accent h-8 px-2"
            >
              <ExternalLink className="size-4" />
            </a>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isRefreshing}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={convertToText}
            disabled={isConverting}
          >
            {isConverting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <StickyNote className="size-4" />
            )}
            <span className="ml-1">Convert</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsDeleteOpen(true)}
            aria-label="Remove article block"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <div
        className={cn("prose max-w-none dark:prose-invert")}
        data-prose="scoped"
      >
        <div
          // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized on the server before persisting
          dangerouslySetInnerHTML={{
            __html: latestDistilled?.contentHtml ?? "",
          }}
        />
      </div>
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Article block?</DialogTitle>
            <DialogDescription>
              This only removes the block from the document. Saved articles are
              not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
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
