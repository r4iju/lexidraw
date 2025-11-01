import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  type RangeSelection,
  type TextNode,
  $createRangeSelection,
  $isTextNode,
  $isElementNode,
  type LexicalNode,
  $setSelection,
  $getSelection,
  $isRangeSelection,
  $getNodeByKey,
} from "lexical";
import { $wrapSelectionInMarkNode } from "@lexical/mark";
import { useCommentPlugin } from "../../CommentPlugin";
import { CommentStore, type Thread } from "../../../commenting";
import { ThreadNode } from "../../../nodes/ThreadNode";
import {
  FindAndSelectTextForCommentSchema,
  AddCommentThreadSchema,
  AddReplyToThreadSchema,
  RemoveCommentFromThreadSchema,
  RemoveCommentThreadSchema,
} from "@packages/types";

export const useCommentTools = () => {
  const {
    getTargetEditorInstance,
    getResolvedEditorAndKeyMap,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();
  const { submitAddComment, deleteCommentOrThread, commentStore } =
    useCommentPlugin();

  /* --------------------------------------------------------------
   * Find and Select Text Tool
   * --------------------------------------------------------------*/
  const findAndSelectTextForComment = tool({
    description:
      "Finds the first occurrence of the specified text in the document and selects it. Subsequent tool calls for 'addCommentThread' will use this selection.",
    inputSchema: FindAndSelectTextForCommentSchema,
    execute: async ({ textToFind, editorKey }) => {
      let success = false;
      let foundText: string | undefined;
      let errorMessage: string | undefined;

      try {
        const targetEditor = getTargetEditorInstance(editorKey);
        targetEditor.update(() => {
          const root = $getRoot();
          const queue: LexicalNode[] = [root]; // LexicalNode import needed if not already present
          let targetNode: TextNode | null = null;
          let offset = -1;

          while (queue.length > 0) {
            const node = queue.shift();
            if ($isTextNode(node)) {
              const textContent = node.getTextContent();
              const index = textContent.indexOf(textToFind);
              if (index !== -1) {
                targetNode = node;
                offset = index;
                break;
              }
            }
            if ($isElementNode(node)) {
              queue.push(...node.getChildren());
            }
          }

          if (targetNode && offset !== -1) {
            const rangeSelection = $createRangeSelection();
            rangeSelection.anchor.set(targetNode.getKey(), offset, "text");
            rangeSelection.focus.set(
              targetNode.getKey(),
              offset + textToFind.length,
              "text",
            );
            $setSelection(rangeSelection);
            foundText = rangeSelection.getTextContent();
            success = true;
          } else {
            errorMessage = `Text "${textToFind}" not found.`;
            $setSelection(null); // Clear selection if not found
          }
        });

        if (success) {
          return {
            success: true,
            content: { summary: `Selected text: "${foundText}".` },
          };
        } else {
          return { success: false, error: errorMessage };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [findAndSelectText] Error:`, msg);
        return { success: false, error: msg };
      }
    },
  });

  /* --------------------------------------------------------------
   * Add Comment Thread Tool (Uses current selection)
   * --------------------------------------------------------------*/
  const addCommentThread = tool({
    description:
      "Creates a new comment thread on the currently selected text in the editor. The selection provides the quote and the area to highlight. Returns the new thread ID and initial comment ID.",
    inputSchema: AddCommentThreadSchema,
    execute: async ({
      initialCommentText,
      authorName,
      threadNodePlacementRelation,
      threadNodePlacementAnchor,
      editorKey,
    }) => {
      try {
        const targetEditor = getTargetEditorInstance(editorKey);

        const author = authorName || "AI Assistant";
        let quote = "";
        let currentSelection: RangeSelection | null = null;

        targetEditor.getEditorState().read(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel) && !sel.isCollapsed()) {
            currentSelection = sel.clone();
            quote = currentSelection.getTextContent();
          } else {
            throw new Error(
              "No valid text selected to comment on. Please select text first using 'findAndSelectText' or ensure a manual selection exists.",
            );
          }
        });

        if (!currentSelection || quote.trim() === "") {
          // This check might be redundant due to the throw above but kept for safety
          return {
            success: false,
            error: "No valid text selected or selection is empty.",
          };
        }

        const firstComment = CommentStore.createComment(
          initialCommentText,
          author,
        );
        const newThread = CommentStore.createThread(quote, [firstComment]);

        // Determine ThreadNode placement
        const placementRelationResolved =
          threadNodePlacementRelation || "appendRoot";
        const editorContext = getResolvedEditorAndKeyMap(editorKey || "main");
        const resolution = await resolveInsertionPoint(
          editorContext,
          placementRelationResolved,
          threadNodePlacementAnchor,
        );
        if (
          resolution.status === "error" &&
          placementRelationResolved !== "appendRoot"
        ) {
          // Error only if specific placement fails; appendRoot is always possible
          return {
            success: false,
            error: `Failed to resolve placement for ThreadNode: ${resolution.message}`,
          };
        }

        let threadNodeKey: string | null = null;

        targetEditor.update(() => {
          // Re-fetch selection within update to ensure it's the latest
          const activeSelection = $getSelection();
          if (
            !$isRangeSelection(activeSelection) ||
            activeSelection.isCollapsed()
          ) {
            // This should ideally not happen if checked before, but as a safeguard:
            throw new Error(
              "Selection disappeared or became invalid during update.",
            );
          }

          const threadNode = new ThreadNode(newThread);
          threadNodeKey = threadNode.getKey();

          if (
            resolution.status === "success" &&
            resolution.type !== "appendRoot"
          ) {
            const targetNode = $getNodeByKey(resolution.targetKey);
            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found for ThreadNode placement.`,
              );
            }
            if (resolution.type === "before") {
              targetNode.insertBefore(threadNode);
            } else {
              targetNode.insertAfter(threadNode);
            }
          } else {
            // Default to appendRoot if no specific placement or if placement resolution failed but was optional (e.g. initial appendRoot)
            $getRoot().append(threadNode);
          }

          // Create MarkNode for highlighting using the active selection
          $wrapSelectionInMarkNode(
            activeSelection,
            activeSelection.isBackward(),
            newThread.id,
          );
        });

        const latestState = editor.getEditorState();
        const stateJson = latestState.toJSON();
        return {
          success: true,
          content: {
            summary: `Created new comment thread (ID: ${newThread.id}) on selected text: "${quote.substring(0, 50)}...".`,
            updatedEditorStateJson: stateJson,
            threadId: newThread.id,
            commentId: firstComment.id,
            newNodeKey: threadNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [addCommentThread] Error:`, errorMsg);
        return { success: false, error: errorMsg };
      }
    },
  });

  /* --------------------------------------------------------------
   * Add Reply to Thread Tool
   * --------------------------------------------------------------*/
  const addReplyToThread = tool({
    description:
      "Adds a reply to an existing comment thread. Returns the new comment ID.",
    inputSchema: AddReplyToThreadSchema,
    execute: async ({ threadId, replyText, authorName, editorKey }) => {
      try {
        const targetEditor = getTargetEditorInstance(editorKey);

        const author = authorName || "AI Assistant";

        if (!commentStore) {
          // Check if commentStore is available from hook
          throw new Error(
            "CommentStore not found via useCommentPlugin. Ensure CommentPluginProvider is an ancestor.",
          );
        }

        const threads = commentStore
          .getComments()
          .filter((c) => c.type === "thread") as Thread[];
        const targetThread = threads.find((t) => t.id === threadId);

        if (!targetThread) {
          return {
            success: false,
            error: `Thread with ID ${threadId} not found.`,
          };
        }

        const newReply = CommentStore.createComment(replyText, author);

        submitAddComment(newReply, false /* isInlineComment */, targetThread);

        const latestState = targetEditor.getEditorState();
        const stateJson = latestState.toJSON();
        return {
          success: true,
          content: {
            summary: `Added reply to thread ID ${threadId}.`,
            updatedEditorStateJson: stateJson,
            threadId: threadId,
            commentId: newReply.id,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [addReplyToThread] Error:`, errorMsg);
        return { success: false, error: errorMsg };
      }
    },
  });

  /* --------------------------------------------------------------
   * Remove Comment from Thread Tool
   * --------------------------------------------------------------*/
  const removeCommentFromThread = tool({
    description:
      "Removes a specific comment from a thread using the thread ID and comment ID.",
    inputSchema: RemoveCommentFromThreadSchema,
    execute: async ({ threadId, commentId, editorKey }) => {
      try {
        const targetEditor = getTargetEditorInstance(editorKey);

        const threads = commentStore
          .getComments()
          .filter((c) => c.type === "thread") as Thread[];
        const targetThread = threads.find((t) => t.id === threadId);

        if (!targetThread) {
          return {
            success: false,
            error: `Thread with ID ${threadId} not found.`,
          };
        }

        const targetComment = targetThread.comments.find(
          (c) => c.id === commentId,
        );

        if (!targetComment) {
          return {
            success: false,
            error: `Comment with ID ${commentId} not found in thread ${threadId}.`,
          };
        }

        deleteCommentOrThread(targetComment, targetThread);

        const latestState = targetEditor.getEditorState();
        const stateJson = latestState.toJSON();
        return {
          success: true,
          content: {
            summary: `Removed comment ID ${commentId} from thread ID ${threadId}.`,
            updatedEditorStateJson: stateJson,
            threadId: threadId,
            commentId: commentId,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [removeCommentFromThread] Error:`, errorMsg);
        return { success: false, error: errorMsg };
      }
    },
  });

  /* --------------------------------------------------------------
   * Remove Comment Thread Tool
   * --------------------------------------------------------------*/
  const removeCommentThread = tool({
    description:
      "Removes an entire comment thread (including all its comments and associated highlights) using the thread ID.",
    inputSchema: RemoveCommentThreadSchema,
    execute: async ({ threadId }) => {
      try {
        const targetThread = commentStore
          .getComments()
          .find((c) => c.id === threadId && c.type === "thread") as
          | Thread
          | undefined;

        if (!targetThread) {
          return {
            success: false,
            error: `Comment thread with ID ${threadId} not found.`,
          };
        }

        deleteCommentOrThread(targetThread);

        const latestState = editor.getEditorState();
        const stateJson = latestState.toJSON();
        return {
          success: true,
          content: {
            summary: `Removed comment thread ID ${threadId}.`,
            updatedEditorStateJson: stateJson,
            threadId: threadId,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [removeCommentThread] Error:`, errorMsg);
        return { success: false, error: errorMsg };
      }
    },
  });

  return {
    findAndSelectTextForComment,
    addCommentThread,
    addReplyToThread,
    removeCommentFromThread,
    removeCommentThread,
  };
};
