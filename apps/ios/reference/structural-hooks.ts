import type { LexicalEditor } from "lexical";

let registering: LexicalEditor | null = null;
export function withStructuralEditor(
  editor: LexicalEditor,
  register: () => void,
) {
  if (registering) throw new Error("Nested structural hook registration");
  registering = editor;
  try {
    register();
  } finally {
    registering = null;
  }
}
export function useLexicalComposerContext(): [LexicalEditor] {
  if (!registering)
    throw new Error("Structural composer hook outside registration");
  return [registering];
}
export function useEffect(register: () => unknown, _dependencies: unknown[]) {
  if (!registering) throw new Error("Structural effect outside registration");
  const cleanup = register();
  if (cleanup !== undefined && typeof cleanup !== "function")
    throw new Error("Unsupported structural effect result");
}
export function useCallback<T>(callback: T, _dependencies: unknown[]): T {
  if (!registering || typeof callback !== "function")
    throw new Error("Unsupported structural callback registration");
  return callback;
}
