/**
 * What leaving an editor with unsaved edits does: autosave saves them on the
 * way out, unless a write made elsewhere is still waiting for the user's
 * answer (see `lib/open-entity-sync.ts`), which a save would give for them.
 */
export function leaveChoice({
  autoSave,
  savesHeld,
}: {
  autoSave: boolean;
  savesHeld: boolean;
}): "save" | "ask" {
  return autoSave && !savesHeld ? "save" : "ask";
}
