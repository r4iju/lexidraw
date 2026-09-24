"use client";

import { TRPCClientError } from "@trpc/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";
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

type Noun = "document" | "drawing";

/**
 * An open entity's sync, which every save of it goes through, and whoever
 * saves once the user keeps their edits over a write made elsewhere.
 */
export type OpenEntity = {
  sync: OpenEntitySync;
  noun: Noun;
  resumers: Set<() => void>;
};

/** The open entity of the editor page, for the parts of it that save. */
export const OpenEntityContext = createContext<OpenEntity | null>(null);

export function useOpenEntityContext(): OpenEntity {
  const open = useContext(OpenEntityContext);
  if (!open)
    throw new Error("useOpenEntityContext must be inside its provider");
  return open;
}

/**
 * Keeps the entity an editor page opened on the stored one; see
 * `lib/open-entity-sync.ts`. Created once per page, above everything that
 * saves, so all of its saves share one queue and one revision.
 */
export function useOpenEntity(
  entity: { id: string; updatedAt: Date; elements: string },
  noun: Noun,
): OpenEntity {
  const utils = api.useUtils();
  const [open] = useState(() => {
    const resumers = new Set<() => void>();
    const sync = createSync(entity, noun, utils, () => {
      for (const resume of resumers) resume();
    });
    return { sync, noun, resumers };
  });

  // External system: the toaster, which outlives the editor.
  useEffect(
    () => () => {
      // Dismissing a question keeps the user's edits; an editor going away
      // must not save them for it.
      open.resumers.clear();
      open.sync.dispose();
      const ids = syncToastIds(entity.id);
      toast.dismiss(ids.conflict);
      toast.dismiss(ids.gone);
    },
    [open, entity.id],
  );

  return open;
}

/**
 * Checks `open` against the server while `editor` shows it. Answers whether
 * an autosave has to wait: see `OpenEntitySync.holdsSaves`.
 */
export function useOpenEntitySync(
  open: OpenEntity,
  {
    editor,
    onSavesResumed,
  }: {
    /** Null until the editor can answer, and for renders that never go stale. */
    editor: SyncedEditor | null;
    /**
     * The user kept their edits over a write elsewhere: autosave, held while
     * the question stood, may save what it holds.
     */
    onSavesResumed?: () => void;
  },
) {
  const { sync, noun, resumers } = open;
  const holdsSaves = useCallback(() => sync.holdsSaves(), [sync]);

  useEffect(() => {
    if (!onSavesResumed) return;
    resumers.add(onSavesResumed);
    return () => {
      resumers.delete(onSavesResumed);
    };
  }, [resumers, onSavesResumed]);

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

  return { holdsSaves };
}

function hasCode(error: unknown, code: "NOT_FOUND" | "CONFLICT"): boolean {
  return error instanceof TRPCClientError && error.data?.code === code;
}

function createSync(
  entity: { id: string; updatedAt: Date; elements: string },
  noun: Noun,
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
          // Gone for this user: deleted, or no longer shared.
          if (hasCode(error, "NOT_FOUND")) return null;
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
      save: async ({ elements, appState }, ifUnmodifiedSince, signal) => {
        try {
          const saved = await utils.client.entities.save.mutate(
            {
              id: entity.id,
              entityType: noun,
              elements,
              appState,
              ifUnmodifiedSince: ifUnmodifiedSince.toISOString(),
            },
            { signal },
          );
          return saved.updatedAt;
        } catch (error) {
          if (hasCode(error, "CONFLICT")) return null;
          throw error;
        }
      },
    },
    noun,
    entityId: entity.id,
    toaster: toast,
    onSavesResumed,
  });
}
