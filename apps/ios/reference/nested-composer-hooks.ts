import { CollaborationContext } from "@lexical/react/LexicalCollaborationContext";
import {
  LexicalComposerContext,
  createLexicalComposerContext,
} from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor } from "lexical";
import type { Context } from "react";

let parent: LexicalEditor | null = null;
let effectCleanups: (() => void)[] | null = null;
export function withNestedParent<T>(
  editor: LexicalEditor,
  run: () => T,
  cleanups?: (() => void)[],
): T {
  if (parent) throw new Error("Nested composer registration is already active");
  parent = editor;
  effectCleanups = cleanups ?? null;
  try {
    return run();
  } finally {
    parent = null;
    effectCleanups = null;
  }
}
export function useContext<T>(context: Context<T>): T {
  if (!parent)
    throw new Error("Nested composer hook outside parent registration");
  // Context identity determines T, which TypeScript cannot narrow generically.
  if ((context as unknown) === LexicalComposerContext) {
    return [
      parent,
      createLexicalComposerContext(null, parent._config.theme),
      // The identity check above selects the composer context’s tuple type.
    ] as unknown as T;
  }
  // Context identity determines the collaboration value’s generic type.
  if ((context as unknown) === CollaborationContext)
    return { isCollabActive: false, yjsDocMap: new Map() } as unknown as T;
  throw new Error("Unknown nested composer context");
}
export function useRef<T>(value: T) {
  return { current: value };
}
export function useMemo<T>(create: () => T, _dependencies: unknown[]): T {
  return create();
}
export function useEffect(register: () => unknown, _dependencies: unknown[]) {
  const cleanup = register();
  if (cleanup !== undefined && typeof cleanup !== "function")
    throw new Error("Unsupported nested composer effect result");
  if (typeof cleanup === "function")
    // React effects return a zero-argument cleanup, narrowed to Function above.
    effectCleanups?.push(cleanup as () => void);
}
