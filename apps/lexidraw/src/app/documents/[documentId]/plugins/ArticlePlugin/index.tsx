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

export const INSERT_ARTICLE_URL_COMMAND: LexicalCommand<void> = createCommand();
export const INSERT_ARTICLE_ENTITY_COMMAND: LexicalCommand<string> =
  createCommand();
export const OPEN_ARTICLE_SAVED_DIALOG_COMMAND: LexicalCommand<void> =
  createCommand();

export default function ArticlePlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [tab, setTab] = useState<"url" | "saved">("url");
  const extract = api.articles.extractFromUrl.useMutation();
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
    return editor.registerCommand(
      INSERT_ARTICLE_URL_COMMAND,
      () => {
        setTab("url");
        setOpen(true);
        return true;
      },
      0,
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      OPEN_ARTICLE_SAVED_DIALOG_COMMAND,
      () => {
        setTab("saved");
        setOpen(true);
        return true;
      },
      0,
    );
  }, [editor]);

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
                    onClick={() => {
                      editor.dispatchCommand(
                        INSERT_ARTICLE_ENTITY_COMMAND,
                        e.id,
                      );
                      setOpen(false);
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
