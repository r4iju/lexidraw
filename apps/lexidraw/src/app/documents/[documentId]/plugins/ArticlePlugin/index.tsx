"use client";

import { $insertNodes, createCommand, type LexicalCommand } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { ArticleNode } from "../../nodes/ArticleNode/ArticleNode";
import type { ArticleDistilled } from "@packages/types";

export const INSERT_ARTICLE_URL_COMMAND: LexicalCommand<string> =
  createCommand();
export const INSERT_ARTICLE_ENTITY_COMMAND: LexicalCommand<string> =
  createCommand();

export default function ArticlePlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [tab, setTab] = useState<"url" | "saved">("url");
  const extract = api.articles.extractFromUrl.useMutation();
  const utils = api.useUtils();
  const [query, setQuery] = useState("");
  const searchQuery = api.entities.search.useQuery(
    { query },
    { enabled: open && tab === "saved" && query.trim().length > 0 },
  );
  const listRecent = api.entities.list.useQuery(
    {
      parentId: null,
      includeArchived: false,
      onlyFavorites: false,
      sortBy: "updatedAt",
      sortOrder: "desc",
      entityTypes: ["url"],
    },
    { enabled: open && tab === "saved" && query.trim().length === 0 },
  );
  const savedArticles = useMemo(() => {
    const items =
      query.trim().length > 0
        ? (searchQuery.data ?? [])
        : (listRecent.data ?? []);
    return items.filter((e) => e.entityType === "url");
  }, [query, searchQuery.data, listRecent.data]);

  // Register commands
  useEffect(() => {
    return editor.registerCommand<string>(
      INSERT_ARTICLE_URL_COMMAND,
      (payload) => {
        const presetUrl = typeof payload === "string" ? payload : "";
        if (presetUrl) {
          void (async () => {
            try {
              const distilled = await extract.mutateAsync({ url: presetUrl });
              editor.update(() => {
                const node = ArticleNode.$createArticleNode({
                  mode: "url",
                  url: presetUrl,
                  distilled,
                });
                $insertNodes([node]);
              });
            } catch {
              // surface via react-query if needed
            }
          })();
          return true;
        }
        setTab("url");
        setOpen(true);
        return true;
      },
      0,
    );
  }, [editor, extract]);

  useEffect(() => {
    return editor.registerCommand(
      INSERT_ARTICLE_ENTITY_COMMAND,
      (entityId: string) => {
        editor.update(() => {
          const node = ArticleNode.$createArticleNode({
            mode: "entity",
            entityId,
          });
          $insertNodes([node]);
        });
        return true;
      },
      0,
    );
  }, [editor]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert Article</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant={tab === "url" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("url")}
            >
              From URL
            </Button>
            <Button
              variant={tab === "saved" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("saved")}
            >
              From saved
            </Button>
          </div>

          {tab === "url" ? (
            <div className="space-y-2">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setOpen(false)}
                  disabled={extract.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      const distilled = await extract.mutateAsync({ url });
                      editor.update(() => {
                        const node = ArticleNode.$createArticleNode({
                          mode: "url",
                          url,
                          distilled,
                        });
                        $insertNodes([node]);
                      });
                      setOpen(false);
                      setUrl("");
                    } catch {
                      // handled by tRPC hooks
                    }
                  }}
                  disabled={!url || extract.isPending}
                >
                  Insert
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search saved articles"
              />
              <div className="max-h-80 overflow-y-auto divide-y divide-border border border-border rounded-md">
                {savedArticles.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-accent"
                    onClick={async () => {
                      try {
                        const entity = await utils.entities.load.fetch({
                          id: e.id,
                        });
                        let snapshot:
                          | Pick<
                              ArticleDistilled,
                              | "title"
                              | "byline"
                              | "siteName"
                              | "wordCount"
                              | "updatedAt"
                              | "contentHtml"
                              | "bestImageUrl"
                            >
                          | undefined;
                        try {
                          const parsed = JSON.parse(
                            entity?.elements ?? "{}",
                          ) as {
                            distilled?: {
                              title?: string;
                              byline?: string | null;
                              siteName?: string | null;
                              wordCount?: number | null;
                              updatedAt?: string;
                              contentHtml?: string;
                              bestImageUrl?: string | null;
                            };
                          };
                          const d = parsed.distilled;
                          if (d?.contentHtml) {
                            snapshot = {
                              title: (d.title as string) || e.title,
                              byline: d.byline ?? null,
                              siteName: d.siteName ?? null,
                              wordCount: d.wordCount ?? null,
                              updatedAt:
                                d.updatedAt ?? new Date().toISOString(),
                              contentHtml: d.contentHtml,
                              bestImageUrl: d.bestImageUrl ?? null,
                            };
                          }
                        } catch {
                          snapshot = undefined;
                        }
                        editor.update(() => {
                          const node = ArticleNode.$createArticleNode({
                            mode: "entity",
                            entityId: e.id,
                            ...(snapshot ? { snapshot } : {}),
                          });
                          $insertNodes([node]);
                        });
                      } finally {
                        setOpen(false);
                      }
                    }}
                  >
                    <div className="text-sm font-medium truncate">
                      {e.title}
                    </div>
                    <div className="text-xs text-muted-foreground">{e.id}</div>
                  </button>
                ))}
                {savedArticles.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">
                    No saved articles found
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
