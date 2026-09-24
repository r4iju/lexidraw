"use client";

import { matchMutation, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { getMutationKey } from "@trpc/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  OpenEntitySync,
  type SyncedEditor,
  type SyncNotice,
} from "~/lib/open-entity-sync";
import { api } from "~/trpc/react";

/**
 * How often a visible editor asks whether its entity moved, on top of asking
 * on mount, focus, and visibility: an agent writing while the tab sits next to
 * its terminal changes neither.
 */
const POLL_MS = 10_000;

/** What a `entities.save` mutation carries, as far as syncing goes. */
const SaveVariables = z.object({ id: z.string(), elements: z.string() });
const SaveResult = z.object({ updatedAt: z.date() });

type Props = {
  entity: { id: string; updatedAt: Date; elements: string };
  noun: "document" | "drawing";
  /** Null until the editor can answer, and for renders that never go stale. */
  editor: SyncedEditor | null;
};

/**
 * Keeps an open editor on the stored entity; see `lib/open-entity-sync.ts`.
 * Every browser save goes through `entities.save`, so the editor's own saves
 * are read off the mutation cache rather than reported by each save site.
 * Answers whether an autosave has to wait: see `OpenEntitySync.holdsSaves`.
 */
export function useOpenEntitySync({ entity, noun, editor }: Props) {
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const [sync] = useState(() => createSync(entity, noun, utils));
  const holdsSaves = useCallback(() => sync.holdsSaves(), [sync]);

  // External system: the toaster, which outlives the editor.
  useEffect(
    () => () => {
      toast.dismiss(toastId(entity.id));
    },
    [entity.id],
  );

  // External systems: the tab's visibility and focus, and a timer.
  useEffect(() => {
    sync.attach(editor);
    if (!editor) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      sync.check().catch((error: unknown) => {
        console.error(`Checking the ${noun} for changes failed:`, error);
      });
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, POLL_MS);
    return () => {
      sync.attach(null);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.clearInterval(timer);
    };
  }, [sync, editor, noun]);

  // External system: the query client's mutation cache.
  useEffect(() => {
    const saveKey = getMutationKey(api.entities.save);
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated") return;
      if (!matchMutation({ mutationKey: saveKey }, event.mutation)) return;
      const variables = SaveVariables.safeParse(event.mutation.state.variables);
      if (!variables.success || variables.data.id !== entity.id) return;
      switch (event.action.type) {
        case "pending":
          sync.saveStarted();
          break;
        case "success": {
          const result = SaveResult.safeParse(event.action.data);
          if (!result.success) {
            sync.saveFailed();
            break;
          }
          sync.saveSucceeded({
            updatedAt: result.data.updatedAt,
            elements: variables.data.elements,
          });
          break;
        }
        case "error":
          sync.saveFailed();
          break;
      }
    });
  }, [queryClient, sync, entity.id]);

  return { holdsSaves };
}

function toastId(id: string): string {
  // Called from an effect's cleanup; see `fingerprint` in
  // `use-synced-excalidraw.ts` for why it opts out of the compiler.
  "use no memo";
  return `open-entity-sync-${id}`;
}

/** A read the server refused because the entity is gone for this user. */
function isNotFound(error: unknown): boolean {
  "use no memo"; // called from a fetch's callback, as above
  return error instanceof TRPCClientError && error.data?.code === "NOT_FOUND";
}

function createSync(
  entity: Props["entity"],
  noun: Props["noun"],
  utils: ReturnType<typeof api.useUtils>,
): OpenEntitySync {
  // A factory for `useState`, not a render: see `fingerprint` in
  // `use-synced-excalidraw.ts` for why it opts out of the compiler.
  "use no memo";
  const id = toastId(entity.id);
  const announce = (notice: SyncNotice) => {
    switch (notice.kind) {
      case "reloaded":
        toast.info(`This ${noun} changed elsewhere`, {
          description: "You are looking at the latest version.",
        });
        return;
      case "conflict":
        toast.warning(`This ${noun} changed elsewhere`, {
          id,
          duration: Number.POSITIVE_INFINITY,
          description: `Reload to see the new version and discard your unsaved edits here, or keep editing yours: saving them will overwrite the other changes.`,
          action: { label: "Reload", onClick: () => sync.reload() },
          cancel: { label: "Keep mine", onClick: () => sync.keep() },
          // Closing the question is not a choice to lose edits.
          onDismiss: () => sync.keep(),
        });
        return;
      case "settled":
        toast.dismiss(id);
        return;
    }
  };
  const sync = new OpenEntitySync(
    { updatedAt: entity.updatedAt, elements: entity.elements },
    {
      updatedAt: async () => {
        try {
          const revision = await utils.entities.revision.fetch(
            { id: entity.id },
            { staleTime: 0 },
          );
          return revision.updatedAt;
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },
      load: async () => {
        const stored = await utils.entities.load.fetch(
          { id: entity.id },
          { staleTime: 0 },
        );
        return { updatedAt: stored.updatedAt, elements: stored.elements };
      },
    },
    announce,
  );
  return sync;
}
