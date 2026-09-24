import type { toast } from "sonner";
import {
  OpenEntitySync,
  type StoredRevision,
  type SyncNotice,
  type SyncSource,
} from "./open-entity-sync";

/** Sonner, as far as an open editor speaks to it. */
export type Toaster = Pick<typeof toast, "info" | "warning" | "dismiss">;

/** The toasts an open entity may show, one of each at most. */
export function syncToastIds(entityId: string) {
  return {
    conflict: `open-entity-sync-${entityId}`,
    gone: `open-entity-gone-${entityId}`,
  };
}

/**
 * An `OpenEntitySync` that puts what it notices to the user as toasts, and
 * the user's answers back to it.
 */
export function announcedSync(options: {
  held: StoredRevision;
  source: SyncSource;
  noun: "document" | "drawing";
  entityId: string;
  toaster: Toaster;
  /** The user kept their edits over a write: autosave may save them now. */
  onSavesResumed: () => void;
}): OpenEntitySync {
  const { noun, toaster } = options;
  const ids = syncToastIds(options.entityId);
  const announce = (notice: SyncNotice) => {
    switch (notice.kind) {
      case "reloaded":
        toaster.info(`This ${noun} changed elsewhere`, {
          description: "You are looking at the latest version.",
        });
        return;
      case "conflict":
        toaster.warning(`This ${noun} changed elsewhere`, {
          id: ids.conflict,
          duration: Number.POSITIVE_INFINITY,
          description:
            "Reload to see the new version and discard your unsaved edits here, or keep editing yours: saving them will overwrite the other changes.",
          action: { label: "Reload", onClick: () => sync.reload() },
          cancel: { label: "Keep mine", onClick: () => sync.keep() },
          // Closing the question is not a choice to lose edits.
          onDismiss: () => sync.keep(),
        });
        return;
      case "settled":
        toaster.dismiss(ids.conflict);
        return;
      case "resumed":
        options.onSavesResumed();
        return;
      case "gone":
        toaster.warning(`This ${noun} is no longer available`, {
          id: ids.gone,
          duration: Number.POSITIVE_INFINITY,
          description: "It was deleted, or is no longer shared with you.",
        });
        return;
      case "back":
        toaster.dismiss(ids.gone);
        return;
    }
  };
  const sync = new OpenEntitySync(options.held, options.source, announce);
  return sync;
}
