"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { tabTitle } from "~/lib/tab-title";
import { api } from "~/trpc/react";

/**
 * The open entity's title, the last crumb of the app bar. Someone who may
 * rename it does so in place: Enter or leaving the field keeps the new title,
 * Escape keeps the old one, and the tab follows.
 */
export function EditableTitle({
  id,
  title,
  canRename,
}: {
  id: string;
  title: string;
  canRename: boolean;
}) {
  const router = useRouter();
  const [shown, setShown] = useState(title);
  const [stored, setStored] = useState(title);
  // A title changed elsewhere (another tab, the ⋯ menu) replaces this one.
  if (title !== stored) {
    setStored(title);
    setShown(title);
  }
  const [draft, setDraft] = useState<string | null>(null);
  const { mutate } = api.entities.update.useMutation();

  const commit = () => {
    const next = draft?.trim();
    setDraft(null);
    if (!next || next === shown) return;
    const previous = shown;
    setShown(next);
    document.title = tabTitle(next);
    mutate(
      { id, title: next },
      {
        onSuccess: () => router.refresh(),
        onError: (error) => {
          setShown(previous);
          document.title = tabTitle(previous);
          toast.error(`Couldn’t rename “${previous}”. Try again.`, {
            description: error.message,
          });
        },
      },
    );
  };

  if (draft !== null)
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: opened by asking to rename
        autoFocus
        aria-label="Title"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setDraft(null);
          }
        }}
        className="h-8 w-full min-w-24 max-w-md rounded-md border border-input bg-background px-2 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    );

  if (!canRename)
    return (
      <span className="block truncate font-medium text-foreground">
        {shown || "Untitled"}
      </span>
    );

  return (
    <button
      type="button"
      aria-label={`Rename ${shown || "Untitled"}`}
      title="Rename"
      onClick={() => setDraft(shown)}
      className="block max-w-full truncate rounded-md px-1.5 py-1 text-left font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {shown || "Untitled"}
    </button>
  );
}
