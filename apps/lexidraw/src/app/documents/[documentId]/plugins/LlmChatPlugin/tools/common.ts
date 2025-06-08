import {
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isRootNode,
  ElementNode,
  LexicalEditor,
  LexicalNode,
} from "lexical";
import {
  InsertionAnchor,
  InsertionPointResolution,
  InsertionRelation,
} from "./common-schemas";
import { SerializedNodeWithKey } from "../../../types";
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

  function findFirstNodeByText(
    currentEditor: LexicalEditor,
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
    const { targetEditor, keyMap } = editorContext;

    if (relation === "appendRoot") {
      return { status: "success", type: "appendRoot" };
    }

    if (!anchor) {
      return {
        status: "error",
        message: `Anchor (key or text) is required for relation '${relation}'.`,
      };
    }

    let liveTargetNode: LexicalNode | null = null;

    try {
      targetEditor.getEditorState().read(() => {
        if (anchor.type === "key") {
          const liveKey = keyMap?.get(anchor.key);
          if (!liveKey) {
            throw new Error(
              `Original key "${anchor.key}" not found in keyMap.`,
            );
          }
          liveTargetNode = $getNodeByKey(liveKey);
          if (!liveTargetNode) {
            throw new Error(
              `Node with live key "${liveKey}" (original: "${anchor.key}") not found.`,
            );
          }
        } else {
          // anchor.type === "text"
          liveTargetNode = findFirstNodeByText(targetEditor, anchor.text); // findFirstNodeByText uses $ Fns
          if (!liveTargetNode) {
            throw new Error(`Node with text "${anchor.text}" not found.`);
          }
        }
      });
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
        message: `Target node for anchor ${JSON.stringify(anchor)} not resolved.`,
      };
    }
    console.log("liveTargetNode is never? ", liveTargetNode);
    return {
      status: "success",
      type: relation,
      // @ts-expect-error - liveTargetNode is probably okey
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
    findFirstNodeByText,
    getTargetEditorInstance,
  };
};
