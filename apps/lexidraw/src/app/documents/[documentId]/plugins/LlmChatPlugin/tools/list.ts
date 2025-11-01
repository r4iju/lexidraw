import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createListItemNode } from "@lexical/list";
import { $createTextNode, $getRoot } from "lexical";
import { $createListNode } from "@lexical/list";
import { $getNodeByKey } from "lexical";
import { $isListItemNode, $isListNode } from "@lexical/list";
import { $isRootNode } from "lexical";
import type { LexicalNode } from "lexical";
import {
  InsertListNodeSchema,
  InsertListItemNodeSchema,
} from "@packages/types";
import type { InsertionAnchor } from "./common-schemas";

export const useListTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
    getTargetEditorInstance,
    getResolvedEditorAndKeyMap,
    resolveAnchorToLiveNode,
  } = useCommonUtilities();

  const [editor] = useLexicalComposerContext();

  const insertListNode = tool({
    description: `Inserts a new ListNode of the specified type 
        (bullet, number, check) containing an initial 
        ListItemNode with the provided text. 
        Uses relation and anchor to determine position.
        Rather than invoking this tool directly, multiple list nodes should be inserted with a batch.
        `,
    inputSchema: InsertListNodeSchema,
    execute: async (options) => {
      return insertionExecutor(
        "insertListNode",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { listType, text } = specificOptions;

          const newList = $createListNode(listType);

          // Split multiline text into individual items so the LLM can just pass a single string.
          const lines = text
            .split(/\n+/)
            .map((l) => l.trim())
            .filter(Boolean);
          if (lines.length === 0) {
            lines.push(""); // ensure at least one item
          }

          for (const line of lines) {
            const clean = line.replace(/^[-*]\s*/, "").trim();
            const listItem = $createListItemNode(
              listType === "check" ? false : undefined,
            );
            listItem.append($createTextNode(clean));
            newList.append(listItem);
          }

          // 🩹 If inserting at root level and the first child is still the placeholder
          // empty paragraph from EMPTY_CONTENT, remove that paragraph before inserting
          // the new list to avoid a leading blank line.
          if (resolution.type === "appendRoot") {
            const root = $getRoot();
            const firstChild = root.getFirstChild();
            if (
              firstChild &&
              firstChild.getType() === "paragraph" &&
              firstChild.getTextContent() === ""
            ) {
              firstChild.remove();
            }
          }

          $insertNodeAtResolvedPoint(resolution, newList);

          return {
            primaryNodeKey: newList.getKey(),
            summaryContext: `${listType} list`,
            additionalContent: {
              listNodeKey: newList.getKey(),
              firstItemKey: newList.getFirstChild()?.getKey(),
            },
          };
        },
        resolveInsertionPoint,
      );
    },
  });

  /* --------------------------------------------------------------
   * Insert ListItemNode Tool
   * --------------------------------------------------------------*/
  const insertListItemNode = tool({
    description:
      "Inserts a new ListItemNode with the provided text. For 'before' or 'after' relations, the anchor MUST resolve to an existing ListItemNode. For 'appendToList' relation, the anchor MUST resolve to an existing ListNode.",
    inputSchema: InsertListItemNodeSchema,
    execute: async ({ text, relation, anchor, editorKey }) => {
      try {
        console.log("[insertListItemNode] Starting", {
          text,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);
        const editorContext = getResolvedEditorAndKeyMap(editorKey);
        let validatedTargetKey: string | null = null;
        let checkValue: boolean | undefined;
        let validationError: string | null = null;

        try {
          const liveNode = resolveAnchorToLiveNode(
            editorContext,
            anchor as InsertionAnchor,
          );
          const initialKey = liveNode.getKey();
          // Perform validation and potential ancestor adjustment inside a read
          targetEditor.read(() => {
            let resolvedTargetNode: LexicalNode | null =
              $getNodeByKey(initialKey);
            if (!resolvedTargetNode) {
              validationError = `Anchor node (live key: ${initialKey}) not found.`;
              return;
            }
            // If anchor was text-based, climb to nearest list/list-item
            if (
              (anchor as { type?: string }).type === "text" &&
              resolvedTargetNode &&
              !$isListItemNode(resolvedTargetNode) &&
              !$isListNode(resolvedTargetNode)
            ) {
              let searchNode: LexicalNode | null = resolvedTargetNode;
              while (searchNode && !$isRootNode(searchNode)) {
                if ($isListItemNode(searchNode) || $isListNode(searchNode)) {
                  resolvedTargetNode = searchNode;
                  break;
                }
                searchNode = searchNode.getParent();
              }
            }

            if (!resolvedTargetNode) {
              const anchorDesc =
                (anchor as { type?: string }).type === "key"
                  ? `key "${(anchor as { key?: string }).key}"`
                  : `text "${(anchor as { text?: string }).text}"`;
              validationError = `Anchor node ${anchorDesc} not found.`;
              return;
            }

            validatedTargetKey = resolvedTargetNode.getKey();
            const targetType = resolvedTargetNode.getType();

            if (relation === "appendToList") {
              if (!$isListNode(resolvedTargetNode)) {
                validationError = `Anchor must resolve to a ListNode for relation 'appendToList', but found ${targetType}.`;
                return;
              }
              checkValue =
                resolvedTargetNode.getListType() === "check"
                  ? false
                  : undefined;
            } else {
              // 'before' or 'after'
              if (!$isListItemNode(resolvedTargetNode)) {
                validationError = `Anchor must resolve to a ListItemNode for relation '${relation}', but found ${targetType}.`;
                return;
              }
              checkValue =
                typeof (
                  resolvedTargetNode as unknown as {
                    getChecked?: () => unknown;
                  }
                ).getChecked?.() === "boolean"
                  ? false
                  : undefined;
            }
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(
            `❌ [insertListItemNode] Anchor resolution failed: ${msg}`,
          );
          return { success: false, error: msg };
        }

        if (validationError) {
          console.error(
            `❌ [insertListItemNode] Validation Error: ${validationError}`,
          );
          return { success: false, error: validationError };
        }

        if (!validatedTargetKey) {
          // Should not happen if validationError is null, but as a safeguard
          throw new Error(
            "[insertListItemNode] Target key was not set after validation despite no error.",
          );
        }

        const finalTargetKey = validatedTargetKey; // Use a const for closure
        let newListItemKey: string | null = null;

        // --- Perform update using validated data ---
        targetEditor.update(() => {
          const resolvedTarget = $getNodeByKey(finalTargetKey);
          if (!resolvedTarget) {
            throw new Error(
              `Target node ${finalTargetKey} disappeared between validation and update.`,
            );
          }

          const newListItem = $createListItemNode(checkValue);
          const textNode = $createTextNode(text);
          newListItem.append(textNode);
          newListItemKey = newListItem.getKey();

          if ($isListNode(resolvedTarget) && relation === "appendToList") {
            resolvedTarget.append(newListItem);
          } else if (
            $isListItemNode(resolvedTarget) &&
            (relation === "before" || relation === "after")
          ) {
            if (relation === "before") {
              resolvedTarget.insertBefore(newListItem);
            } else {
              resolvedTarget.insertAfter(newListItem);
            }
          } else {
            throw new Error(
              `Invalid state: Cannot insert list item with relation '${relation}' relative to node type ${resolvedTarget.getType()} after validation. Target Key: ${finalTargetKey}`,
            );
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = latestState.toJSON();
        const summary = `Inserted list item ${relation} target (key: ${finalTargetKey}).`;
        console.log(`✅ [insertListItemNode] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newListItemKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertListItemNode] Error:`, errorMsg);
        let stateJsonOnError = {};
        try {
          stateJsonOnError = editor.getEditorState().toJSON();
        } catch (_stateErr) {
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert list item",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  return {
    insertListNode,
    insertListItemNode,
  };
};
