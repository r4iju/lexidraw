/** Auto-save is on for everyone who hasn't turned it off. */
export function autoSaveEnabled(stored?: { enabled?: boolean }): boolean {
  return stored?.enabled ?? true;
}
