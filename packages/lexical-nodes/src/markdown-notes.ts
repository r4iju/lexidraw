/**
 * How an import read markdown it could have read another way, for the writer
 * to see. Transformers report while an import runs; only a caller that asked
 * for notes is listening, and an import is synchronous, so one slot suffices.
 */
let listening: string[] | null = null;

export function collectMarkdownNotes<T>(run: () => T): {
  result: T;
  notes: string[];
} {
  const outer = listening;
  const notes: string[] = [];
  listening = notes;
  try {
    return { result: run(), notes: [...new Set(notes)] };
  } finally {
    listening = outer;
  }
}

export function reportMarkdownNote(note: string): void {
  listening?.push(note);
}
