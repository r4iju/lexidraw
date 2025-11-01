import {
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isRootNode,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import type {
  InsertionAnchor,
  InsertionPointResolution,
  InsertionRelation,
} from "./common-schemas";
import type { SerializedNodeWithKey } from "../../../types";
import { useKeyedSerialization } from "../use-serialized-editor-state";
import { useEditorRegistry } from "../../../context/editors-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

type NodeInsertionResult = {
  primaryNodeKey: string | null; // This will populate content.newNodeKey
  summaryContext?: string;
  additionalContent?: Record<string, string | undefined>; // For other keys like listNodeKey, firstItemKey
};

type NodeInserter<O extends Record<string, unknown>> = (
  resolution: Exclude<InsertionPointResolution, { status: "error" }>, // The resolved success location
  options: O, // The specific arguments for the tool
  currentEditor: LexicalEditor, // Pass the current editor instance
) => NodeInsertionResult;

export const useCommonUtilities = () => {
  /** The generic executor function. */
  const { getEditorEntry } = useEditorRegistry();
  const [editor] = useLexicalComposerContext();
  const { serializeEditorStateWithKeys } = useKeyedSerialization();

  function getResolvedEditorAndKeyMap(editorKey?: string): {
    targetEditor: LexicalEditor;
    keyMap: Map<string, string> | null;
    originalRoot: SerializedNodeWithKey | null;
  } {
    if (editorKey) {
      const entry = getEditorEntry(editorKey);
      if (!entry) {
        throw new Error(`Editor entry not found for key ${editorKey}.`);
      }
      return {
        targetEditor: entry.editor,
        keyMap: entry.keyMap,
        originalRoot: entry.originalStateRoot,
      };
    }
    return { targetEditor: editor, keyMap: null, originalRoot: null };
  }

  async function insertionExecutor<O extends Record<string, unknown>>(
    toolName: string,
    baseEditor: LexicalEditor, // The base editor instance from useLexicalComposerContext
    options: O & {
      relation: InsertionRelation;
      anchor?: InsertionAnchor;
      editorKey?: string;
    },
    inserter: NodeInserter<O>,
    resolveInsertionPt: (
      // THIS TYPE SIGNATURE WILL CHANGE
      editorContext: {
        targetEditor: LexicalEditor;
        keyMap: Map<string, string> | null;
        originalRoot: SerializedNodeWithKey | null;
      },
      relation: InsertionRelation,
      anchor?: InsertionAnchor,
    ) => Promise<InsertionPointResolution>, // Function to resolve insertion point
  ) {
    const { relation, anchor, editorKey, ...specificOptions } = options;

    try {
      console.log(`[${toolName}] Starting`, options);

      // const targetEditor = getEditorInstance(editorKey); // REPLACED
      const editorContext = getResolvedEditorAndKeyMap(editorKey); // Get context once

      const resolution = await resolveInsertionPt(
        editorContext,
        relation,
        anchor,
      );

      if (resolution.status === "error") {
        console.error(`❌ [${toolName}] Error: ${resolution.message}`);
        return { success: false, error: resolution.message };
      }

      // After the status check, resolution is guaranteed to be a success type
      const successResolution = resolution as Exclude<
        InsertionPointResolution,
        { status: "error" }
      >;

      let insertionOutcome: NodeInsertionResult = {
        primaryNodeKey: null,
      };
      // targetEditor.update(() => { // REPLACED
      editorContext.targetEditor.update(() => {
        insertionOutcome = inserter(
          successResolution,
          specificOptions as unknown as O,
          // targetEditor, // REPLACED
          editorContext.targetEditor,
        );
      });

      // Use baseEditor for getting the overall state, as targetEditor might be a nested one.
      const latestState = baseEditor.getEditorState();
      const stateJson = latestState.toJSON();

      const targetKeyForSummary =
        successResolution.type === "appendRoot"
          ? "root"
          : successResolution.targetKey;
      let summary: string;
      if (successResolution.type === "appendRoot") {
        summary = `Appended new ${insertionOutcome.summaryContext ?? toolName}.`;
      } else {
        summary = `Inserted ${insertionOutcome.summaryContext ?? toolName} ${successResolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
      }

      console.log(`✅ [${toolName}] Success: ${summary}`);

      return {
        success: true,
        content: {
          summary,
          updatedEditorStateJson: stateJson,
          newNodeKey: insertionOutcome.primaryNodeKey ?? undefined, // Use newNodeKey for the final output as per ResultSchema
          ...(insertionOutcome.additionalContent ?? {}), // Spread additional specific keys
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`❌ [${toolName}] Error:`, errorMsg);
      // Use baseEditor for getting the overall state on error.
      const stateJson = baseEditor.getEditorState().toJSON();
      return {
        success: false,
        error: errorMsg,
        content: {
          summary: `Failed to insert ${toolName}`,
          updatedEditorStateJson: stateJson,
          newNodeKey: undefined,
        },
      };
    }
  }

  function $insertNodeAtResolvedPoint(
    resolution: Exclude<InsertionPointResolution, { status: "error" }>,
    nodeToInsert: LexicalNode,
  ): void {
    if (resolution.type === "appendRoot") {
      $getRoot().append(nodeToInsert);
    } else {
      const targetNode = $getNodeByKey(resolution.targetKey);
      if (!targetNode) {
        throw new Error(
          `Target node with key ${resolution.targetKey} vanished during insertion.`,
        );
      }
      if (resolution.type === "before") {
        targetNode.insertBefore(nodeToInsert);
      } else {
        // 'after'
        targetNode.insertAfter(nodeToInsert);
      }
    }
  }

  /**
   * Builds a one-off mapping from original (stable) keys to the current live keys
   * for a given editor by walking the original keyed tree in lockstep with the
   * current editor state's node tree (child-index pairing).
   */
  function buildOneOffKeyMap(
    originalRoot: SerializedNodeWithKey,
    targetEditor: LexicalEditor,
  ): Map<string, string> {
    const map = new Map<string, string>();
    targetEditor.getEditorState().read(() => {
      const liveRoot = $getRoot();
      // Map root → root (useful for completeness)
      map.set(originalRoot.key as string, liveRoot.getKey());

      const stack: Array<{
        original: SerializedNodeWithKey;
        live: LexicalNode | null;
      }> = [{ original: originalRoot, live: liveRoot }];

      while (stack.length) {
        const { original, live } = stack.pop() as {
          original: SerializedNodeWithKey;
          live: LexicalNode | null;
        };
        if (!live) continue;

        // Record this pair
        map.set(original.key as string, live.getKey());

        // If both sides are elements, walk children by index
        if (
          Array.isArray(original.children) &&
          original.children.length > 0 &&
          $isElementNode(live)
        ) {
          const liveChildren = live.getChildren();
          const len = Math.min(original.children.length, liveChildren.length);
          for (let i = 0; i < len; i++) {
            const origChild = original.children[i];
            const liveChild = liveChildren[i] as LexicalNode | undefined;
            if (origChild && liveChild) {
              stack.push({ original: origChild, live: liveChild });
            }
          }
        }
      }
    });
    return map;
  }

  /**
   * Resolves an original (stable) node key to the current live key using the
   * editor registry map when available, otherwise rebuilding a one-off map from
   * the provided originalRoot and current editor state. No fallback to treating
   * the provided key as live.
   */
  function resolveStableKeyToLiveKey(
    editorContext: {
      targetEditor: LexicalEditor;
      keyMap: Map<string, string> | null;
      originalRoot: SerializedNodeWithKey | null;
    },
    originalKey: string,
  ): string {
    const { targetEditor, keyMap } = editorContext;
    let { originalRoot } = editorContext;

    if (keyMap?.has(originalKey)) {
      return keyMap.get(originalKey) as string;
    }

    if (!originalRoot) {
      // Derive a keyed original snapshot from the current editor state
      const keyed = serializeEditorStateWithKeys(targetEditor.getEditorState());
      if (!keyed) {
        throw new Error(
          `Unable to serialize current editor state to derive a stable key map for key "${originalKey}".`,
        );
      }
      originalRoot = keyed.root;
    }

    const rebuilt = buildOneOffKeyMap(originalRoot, targetEditor);
    console.log(
      "[anchor-resolver] Built one-off keyMap",
      JSON.stringify({ originalKey, rebuiltSize: rebuilt.size }),
    );
    const live = rebuilt.get(originalKey);
    if (!live) {
      throw new Error(
        `Original key "${originalKey}" not found after one-off keyMap rebuild.`,
      );
    }
    return live;
  }

  /**
   * Centralized anchor → live node resolver. Handles type normalization and
   * stable-key mapping.
   */
  function resolveAnchorToLiveNode(
    editorContext: {
      targetEditor: LexicalEditor;
      keyMap: Map<string, string> | null;
      originalRoot: SerializedNodeWithKey | null;
    },
    anchor: InsertionAnchor,
  ): LexicalNode {
    // Normalize anchor type (accept legacy "nodeKey")
    let normalizedAnchor: InsertionAnchor = anchor;
    if ((anchor as unknown as { type?: string }).type === "nodeKey") {
      normalizedAnchor = { type: "key", key: (anchor as { key: string }).key };
    }

    let liveNode: LexicalNode | null = null;
    const { targetEditor } = editorContext;
    targetEditor.getEditorState().read(() => {
      if (normalizedAnchor.type === "key") {
        const liveKey = resolveStableKeyToLiveKey(
          editorContext,
          normalizedAnchor.key,
        );
        liveNode = $getNodeByKey(liveKey);
        if (!liveNode) {
          throw new Error(
            `Node with live key "${liveKey}" (original: "${normalizedAnchor.key}") not found.`,
          );
        }
      } else if (normalizedAnchor.type === "text") {
        liveNode = findFirstNodeByText(targetEditor, normalizedAnchor.text);
        if (!liveNode) {
          throw new Error(
            `Node with text "${normalizedAnchor.text}" not found.`,
          );
        }
      } else {
        const t = (normalizedAnchor as unknown as { type?: string }).type;
        throw new Error(
          `Unknown anchor type: "${t}". Expected "key" or "text". Received anchor: ${JSON.stringify(
            anchor,
          )}`,
        );
      }
    });
    // At this point liveNode must be set or an error thrown
    // @ts-expect-error - we just validated
    return liveNode as LexicalNode;
  }

  function findFirstNodeByText(
    _currentEditor: LexicalEditor,
    text?: string,
  ): ElementNode | null {
    if (!text) return null;
    const root = $getRoot();
    const queue: ElementNode[] = [root];
    while (queue.length) {
      const n = queue.shift();
      if (!n) break;
      if ($isElementNode(n) && !$isRootNode(n) && !n.isInline()) {
        if (n.getTextContent().includes(text)) return n;
      }
      if ($isElementNode(n))
        queue.push(...n.getChildren().filter($isElementNode));
    }
    return null;
  }

  /**
   * Resolves the target node and relation for an insertion operation.
   * This should be called *outside* an editor update cycle.
   * It returns the target node's key for safe use within an update cycle.
   */
  async function resolveInsertionPoint(
    editorContext: {
      // Pass the whole context
      targetEditor: LexicalEditor;
      keyMap: Map<string, string> | null;
      originalRoot: SerializedNodeWithKey | null;
    },
    relation: InsertionRelation,
    anchor?: InsertionAnchor,
  ): Promise<InsertionPointResolution> {
    if (relation === "appendRoot") {
      return { status: "success", type: "appendRoot" };
    }

    if (!anchor) {
      return {
        status: "error",
        message: `Anchor (key or text) is required for relation '${relation}'.`,
      };
    }

    // Normalize anchor type: convert "nodeKey" to "key" (handles LLM schema mismatches)
    let normalizedAnchor: InsertionAnchor = anchor;
    if (
      (anchor as unknown as { type?: string }).type === "nodeKey" &&
      "key" in anchor
    ) {
      normalizedAnchor = { type: "key", key: (anchor as { key: string }).key };
    }

    let liveTargetNode: LexicalNode | null = null;

    try {
      liveTargetNode = resolveAnchorToLiveNode(editorContext, normalizedAnchor);
    } catch (e) {
      return {
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      };
    }

    if (!liveTargetNode) {
      // Should be caught by throws above, but as a fallback
      return {
        status: "error",
        message: `Target node for anchor ${JSON.stringify(normalizedAnchor)} not resolved.`,
      };
    }
    console.log("liveTargetNode is never? ", liveTargetNode);
    return {
      status: "success",
      type: relation,
      targetKey: liveTargetNode.getKey(),
    };
  }

  function getTargetEditorInstance(editorKey?: string): LexicalEditor {
    if (editorKey) {
      const entry = getEditorEntry(editorKey);
      if (!entry) {
        throw new Error(`Editor with key ${editorKey} not found in registry.`);
      }
      return entry.editor;
    }
    return editor;
  }

  return {
    insertionExecutor,
    getResolvedEditorAndKeyMap,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
    resolveStableKeyToLiveKey,
    resolveAnchorToLiveNode,
    findFirstNodeByText,
    getTargetEditorInstance,
  };
};
