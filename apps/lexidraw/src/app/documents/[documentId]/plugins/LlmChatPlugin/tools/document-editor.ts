import { tool } from "ai";
import { z } from "zod";
import { EditorKeySchema } from "./common-schemas";
import { useKeyedSerialization } from "../use-serialized-editor-state";
import { $getNodeByKey } from "lexical";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

export const useDocumentEditorTools = () => {
  const { serializeEditorStateWithKeys } = useKeyedSerialization();
  const { getResolvedEditorAndKeyMap, getTargetEditorInstance } =
    useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  const patchNodeByJSON = tool({
    description: `Replaces a node with a JSON‑patched clone.
      Internally:
        1. exportJSON() → current shape
        2. Object.fromEntries(patchProperties) → patch
        3. { …current, …patch } → merged  (if node class supplies importJSON)
        4. Otherwise mutate the existing node in‑place via setters / direct props
        5. importJSON(merged) → new node (only for the first path)
        6. swap old ↔︎ new, keeping the same spot in the tree.`, // Ensure description is accurate
    parameters: z.object({
      editorKey: EditorKeySchema.optional(), // Ensure editorKey is optional if it can be
      nodeKey: z.string().describe("Original key of the node to edit."), // Explicitly original
      patchProperties: z
        .array(
          z.object({
            key: z.string(),
            value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
          }),
        )
        .nonempty()
        .describe(
          "Array of patch records to merge into the node. " +
            "Each record is `{ key: string; value: string|number|boolean|null }`.",
        ),
    }),

    execute: async ({
      nodeKey: originalNodeKey,
      patchProperties,
      editorKey,
    }) => {
      const { targetEditor, keyMap } = getResolvedEditorAndKeyMap(editorKey);
      const liveNodeKey = keyMap?.get(originalNodeKey);
      if (!liveNodeKey && originalNodeKey !== "root") {
        // 'root' key might not be in keyMap if it's implicit
        // Check if originalNodeKey is 'root' and targetEditor is the main editor. Special handling might be needed or disallow 'root' patching.
        // For now, assume non-root keys must be in map.
        return {
          success: false,
          error: `Live node for original key "${originalNodeKey}" not found in keyMap.`,
        };
      }
      const finalNodeKey =
        originalNodeKey === "root" ? "root" : (liveNodeKey as string); // Use liveNodeKey if not 'root'

      try {
        targetEditor.update(() => {
          // log the current state of the target editor
          // serialize with keys
          const currentState = serializeEditorStateWithKeys(
            targetEditor.getEditorState(),
          );
          console.log(
            "🛠️ [ToolFactory: patchNodeByJSON] current state:",
            currentState,
          );

          const node = $getNodeByKey(finalNodeKey);
          if (!node)
            throw new Error(`Node ${finalNodeKey} not found during update.`);

          patchProperties.forEach(({ key, value }) => {
            // @ts-expect-error - text nodes accept setTextContent
            if (key === "text" && typeof node.setTextContent === "function") {
              console.log(
                "🛠️ [ToolFactory: patchNodeByJSON] setting text content with setTextContent:",
                value,
              );
              // @ts-expect-error - text nodes accept setTextContent
              node.setTextContent(String(value));
              return;
            }

            // Generic setter e.g. set<Prop>()
            const setterName =
              "set" + key.charAt(0).toUpperCase() + key.slice(1);
            // @ts-expect-error - most nodes accept dynamic setters
            if (typeof node[setterName] === "function") {
              console.log(
                "🛠️ [ToolFactory: patchNodeByJSON] setting property with setter named:",
                setterName,
                "for node:",
                node,
              );
              // @ts-expect-error - most nodes accept dynamic setters
              node[setterName](value);
              return;
            }

            // As last resort, mutate property directly (non‑reactive but OK for static fields)
            try {
              // @ts-expect-error – allow dynamic write
              node[key] = value;
            } catch {
              console.warn(
                `[patchNodeByJSON] Cannot set ${key} on node type ${node.getType()}.`,
              );
            }
          });
        });

        const stateJson = editor.getEditorState().toJSON();
        return {
          success: true,
          content: {
            summary: `Patched node ${finalNodeKey} (properties: ${patchProperties.map((p) => p.key).join(", ")}).`,
            updatedEditorStateJson: stateJson,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[patchNodeByJSON] Error:", msg);
        return { success: false, error: msg };
      }
    },
  });

  const removeNode = tool({
    description: "Removes a node from the document using its key.",
    parameters: z.object({
      nodeKey: z.string().describe("The key of the node to remove."),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({ nodeKey, editorKey }) => {
      try {
        let removed = false;
        const targetEditor = getTargetEditorInstance(editorKey);
        targetEditor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (node) {
            node.remove();
            removed = true;
          }
        });
        if (removed) {
          return {
            success: true,
            content: { summary: `Removed node with key ${nodeKey}.` },
          };
        } else {
          return {
            success: false,
            error: `Node with key ${nodeKey} not found.`,
          };
        }
      } catch (error: unknown) {
        // Need to assert error is an Error instance to access message safely
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    },
  });

  /* --------------------------------------------------------------
   * Move Node Tool
   * --------------------------------------------------------------*/
  const moveNode = tool({
    description:
      "Moves a node relative to another node (before or after). Only works for direct siblings within the same parent.",
    parameters: z.object({
      nodeKey: z.string().describe("The key of the node to move."),
      anchorKey: z.string().describe("The key of the anchor node."),
      relation: z
        .enum(["before", "after"])
        .describe("Whether to move the node before or after the anchor."),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({ nodeKey, anchorKey, relation, editorKey }) => {
      try {
        let moved = false;
        let errorMsg: string | null = null;
        const targetEditor = getTargetEditorInstance(editorKey);
        targetEditor.update(() => {
          const nodeToMove = $getNodeByKey(nodeKey);
          const anchorNode = $getNodeByKey(anchorKey);

          if (!nodeToMove) {
            errorMsg = `Node to move (key: ${nodeKey}) not found.`;
            return;
          }
          if (!anchorNode) {
            errorMsg = `Anchor node (key: ${anchorKey}) not found.`;
            return;
          }

          // Basic check: Ensure both nodes are attached and have the same parent
          if (!nodeToMove.isAttached() || !anchorNode.isAttached()) {
            errorMsg = `One or both nodes (move: ${nodeKey}, anchor: ${anchorKey}) are not attached to the editor state. Cannot move unattached nodes.`;
            return;
          }

          const moveParent = nodeToMove.getParent();
          const anchorParent = anchorNode.getParent();

          if (!moveParent || !anchorParent) {
            errorMsg = `One or both nodes (move: ${nodeKey}, anchor: ${anchorKey}) lack a parent node. This might indicate they are root-level or improperly structured.`;
            return;
          }

          if (moveParent.getKey() !== anchorParent.getKey()) {
            errorMsg = `Nodes must be siblings (have the same parent) to be moved relative to each other. Move node parent key: ${moveParent.getKey()}, Anchor node parent key: ${anchorParent.getKey()}.`;
            return;
          }

          // Perform the move
          if (relation === "before") {
            anchorNode.insertBefore(nodeToMove); // This automatically removes nodeToMove from its previous position
            moved = true;
          } else if (relation === "after") {
            anchorNode.insertAfter(nodeToMove); // This automatically removes nodeToMove from its previous position
            moved = true;
          }
        });

        if (moved) {
          return {
            success: true,
            content: {
              summary: `Moved node ${nodeKey} ${relation} node ${anchorKey}.`,
            },
          };
        } else {
          // Prioritize specific error messages from the update block
          return {
            success: false,
            error: errorMsg ?? "Move operation failed for an unknown reason.",
          };
        }
      } catch (error: unknown) {
        console.error("Error during moveNode execution:", error);
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `An unexpected error occurred while moving the node: ${message}`,
        };
      }
    },
  });

  return {
    patchNodeByJSON,
    removeNode,
    moveNode,
  };
};
