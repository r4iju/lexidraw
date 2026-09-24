"use client";

import { matchMutation, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { getMutationKey } from "@trpc/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import type {
  CheckTrigger,
  OpenEntitySync,
  SyncedEditor,
} from "~/lib/open-entity-sync";
import { announcedSync, syncToastIds } from "~/lib/open-entity-toasts";
import { api } from "~/trpc/react";

/**
 * How often a visible editor asks whether its entity moved, on top of asking
 * on mount, focus, and visibility: an agent writing while the tab sits next to
 * its terminal changes neither.
 */
const POLL_MS = 10_000;

/** What a `entities.save` mutation carries, as far as syncing goes. */
const SaveVariables = z.object({
  id: z.string(),
  elements: z.string(),
  appState: z.string().nullish(),
});
const SaveResult = z.object({ updatedAt: z.date() });

type Props = {
  entity: { id: string; updatedAt: Date; elements: string };
  noun: "document" | "drawing";
  /** Null until the editor can answer, and for renders that never go stale. */
  editor: SyncedEditor | null;
  /**
   * The user kept their edits over a write elsewhere: autosave, held while
   * the question stood, may save what it holds.
   */
  onSavesResumed?: () => void;
};

/**
 * Keeps an open editor on the stored entity; see `lib/open-entity-sync.ts`.
 * Every browser save goes through `entities.save`, so the editor's own saves
 * are read off the mutation cache rather than reported by each save site.
 * Answers whether an autosave has to wait: see `OpenEntitySync.holdsSaves`.
 */
export function useOpenEntitySync({
  entity,
  noun,
  editor,
  onSavesResumed,
}: Props) {
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  // Who saves once the user keeps their edits: whatever editor is mounted.
  const [resumers] = useState(() => new Set<() => void>());
  const [sync] = useState(() =>
    createSync(entity, noun, utils, () => {
      for (const resume of resumers) resume();
    }),
  );
  const holdsSaves = useCallback(() => sync.holdsSaves(), [sync]);

  useEffect(() => {
    if (!onSavesResumed) return;
    resumers.add(onSavesResumed);
    return () => {
      resumers.delete(onSavesResumed);
    };
  }, [resumers, onSavesResumed]);

  // External system: the toaster, which outlives the editor.
  useEffect(
    () => () => {
      // Dismissing a question keeps the user's edits; an editor going away
      // must not save them for it.
      resumers.clear();
      const ids = syncToastIds(entity.id);
      toast.dismiss(ids.conflict);
      toast.dismiss(ids.gone);
    },
    [resumers, entity.id],
  );

  // External systems: the tab's visibility and focus, and a timer.
  useEffect(() => {
    sync.attach(editor);
    if (!editor) return;
    const check = (trigger: CheckTrigger) => {
      if (document.visibilityState !== "visible") return;
      sync.check(trigger).catch((error: unknown) => {
        console.error(`Checking the ${noun} for changes failed:`, error);
      });
    };
    const onReturn = () => check("focus");
    const poll = () => check("poll");
    onReturn();
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      sync.attach(null);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.clearInterval(timer);
    };
  }, [sync, editor, noun]);

  // External system: the query client's mutation cache.
  useEffect(() => {
    const saveKey = getMutationKey(api.entities.save);
    // Each save's answer is reported under the id it went out with, so an
    // answer the sync stopped waiting for is told apart from a newer one.
    const saves = new Map<number, number>();
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const { mutation, action } = event;
      if (!matchMutation({ mutationKey: saveKey }, mutation)) return;
      const variables = SaveVariables.safeParse(mutation.state.variables);
      if (!variables.success || variables.data.id !== entity.id) return;
      if (action.type === "pending") {
        if (!saves.has(mutation.mutationId))
          saves.set(mutation.mutationId, sync.saveStarted());
        return;
      }
      if (action.type !== "success" && action.type !== "error") return;
      const save = saves.get(mutation.mutationId);
      if (save === undefined) return;
      saves.delete(mutation.mutationId);
      const result =
        action.type === "success" ? SaveResult.safeParse(action.data) : null;
      if (!result?.success) {
        sync.saveFailed(save);
        return;
      }
      sync.saveSucceeded(
        save,
        { updatedAt: result.data.updatedAt, elements: variables.data.elements },
        variables.data.appState ?? undefined,
      );
    });
  }, [queryClient, sync, entity.id]);

  return { holdsSaves };
}

/** A read the server refused because the entity is gone for this user. */
function isNotFound(error: unknown): boolean {
  return error instanceof TRPCClientError && error.data?.code === "NOT_FOUND";
}

function createSync(
  entity: Props["entity"],
  noun: Props["noun"],
  utils: ReturnType<typeof api.useUtils>,
  onSavesResumed: () => void,
): OpenEntitySync {
  return announcedSync({
    held: { updatedAt: entity.updatedAt, elements: entity.elements },
    source: {
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
    noun,
    entityId: entity.id,
    toaster: toast,
    onSavesResumed,
  });
}
