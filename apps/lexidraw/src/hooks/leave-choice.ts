/**
 * What leaving an editor does. Unsaved edits are saved on the way out by
 * autosave, and put to the user without it. A write made elsewhere that is
 * still waiting for the user's answer (see `lib/open-entity-sync.ts`) is
 * always put to them, since a save would give that answer for them.
 */
export function leaveChoice({
  unsaved,
  autoSave,
  savesHeld,
}: {
  unsaved: boolean;
  autoSave: boolean;
  savesHeld: boolean;
}): "leave" | "save" | "ask" {
  if (savesHeld) return "ask";
  if (!unsaved) return "leave";
  return autoSave ? "save" : "ask";
}
