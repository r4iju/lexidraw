import { createContext, PropsWithChildren, useContext, useEffect } from "react";
import { tool } from "ai";
import { z } from "zod";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import {
  MermaidConfig,
  ExcalidrawConfig,
} from "@excalidraw/mermaid-to-excalidraw";
/** Lexical utils */
import {
  $createParagraphNode,
  $createTextNode,
  LexicalEditor,
  $getRoot,
  $isElementNode,
  $isRootNode,
  $isTextNode,
  $getNodeByKey,
  $getSelection,
  $createRangeSelection,
  $setSelection,
  $isRangeSelection,
  TextNode,
  RangeSelection,
  LexicalNode,
} from "lexical";
import {
  $createCodeNode,
  $isCodeHighlightNode,
  $createCodeHighlightNode,
} from "@lexical/code";
import { $createHeadingNode } from "@lexical/rich-text";
import {
  $createListNode,
  $createListItemNode,
  $isListNode,
  $isListItemNode,
} from "@lexical/list";
import { $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
} from "@lexical/table";
import { $createHashtagNode, $isHashtagNode } from "@lexical/hashtag";
import { $createLinkNode } from "@lexical/link";
import { $wrapSelectionInMarkNode } from "@lexical/mark";
/** Standard Nodes */
import { ElementNode } from "lexical";

/** Custom Nodes */
import { EquationNode } from "../../nodes/EquationNode";
import { FigmaNode } from "../../nodes/FigmaNode";
import { CollapsibleContainerNode } from "../../plugins/CollapsiblePlugin/CollapsibleContainerNode";
import { CollapsibleContentNode } from "../../plugins/CollapsiblePlugin/CollapsibleContentNode";
import { CollapsibleTitleNode } from "../../plugins/CollapsiblePlugin/CollapsibleTitleNode";
import { ExcalidrawNode } from "../../nodes/ExcalidrawNode/index";
import { LayoutContainerNode } from "../../nodes/LayoutContainerNode";
import { LayoutItemNode } from "../../nodes/LayoutItemNode";
import { PageBreakNode } from "../../nodes/PageBreakNode";
import { PollNode } from "../../nodes/PollNode";
import { TweetNode } from "../../nodes/TweetNode";
import { YouTubeNode } from "../../nodes/YouTubeNode";
import {
  SlideNode,
  DEFAULT_SLIDE_DECK_DATA,
  SlideDeckData,
  SlideData,
  SlideElementSpec,
  EditorStateJSON,
} from "../../nodes/SlideNode/SlideNode";

import { useChatDispatch } from "./llm-chat-context";
import { useRuntimeSpec } from "./reflect-editor-runtime";
import { useLexicalStyleUtils } from "../../utils/lexical-style-utils";
import { useLexicalImageInsertion } from "~/hooks/use-image-insertion";
import { useLexicalImageGeneration } from "~/hooks/use-image-generation";
import { useMemo } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RuntimeToolMap } from "../../context/llm-context";
import type { Thread } from "../../commenting";
import { CommentStore } from "../../commenting";
import { useCommentPlugin } from "../../plugins/CommentPlugin";
import { ThreadNode } from "../../nodes/ThreadNode";
import { MermaidToExcalidrawResult } from "@excalidraw/mermaid-to-excalidraw/dist/interfaces";
import { MermaidNode } from "../../nodes/MermaidNode";
import { useEditorRegistry } from "../../context/editors-context";

/* ------------------------------------------------------------------
 * Types & helpers
 * -----------------------------------------------------------------*/

// Schema for anchor used in insertion tools
const InsertionAnchorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z
      .literal("key")
      .describe('type can be "key" or "text", never heading'),
    key: z.string(),
  }),
  z.object({
    type: z
      .literal("text")
      .describe('type can be "key" or "text", never heading'),
    text: z.string(),
  }),
]);
type InsertionAnchor = z.infer<typeof InsertionAnchorSchema>;

const EditorKeySchema = z
  .string()
  .describe(
    "Key to target a nested editor, e.g., 'deckNodeKey/slideId/boxId'. Defaults to the main editor.",
  );

// Schema for relation used in insertion tools
const InsertionRelationSchema = z
  .enum(["before", "after", "appendRoot"])
  .default("appendRoot");
type InsertionRelation = z.infer<typeof InsertionRelationSchema>;

// Enum for list types
const ListTypeEnum = z.enum(["bullet", "number", "check"]);
type ListType = z.infer<typeof ListTypeEnum>;

// Anchor schema specific to inserting ListItems (must target ListItem or List)
const ListItemAnchorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z
      .literal("key")
      .describe('type can be "key" or "text", never "heading'),
    key: z
      .string()
      .describe("Use the key of the target ListItemNode or ListNode."),
  }),
  z.object({
    type: z
      .literal("text")
      .describe('type can be "key" or "text", never heading'),
    text: z
      .string()
      .describe(
        "Use text content to identify the target ListItemNode or ListNode.",
      ),
  }),
]);

// Return type for the insertion point resolver (Restored)
type InsertionPointResolution =
  | { status: "success"; type: "appendRoot" }
  | {
      status: "success";
      type: "before" | "after";
      targetKey: string;
      // We return the key to avoid passing live node references outside the update cycle
    }
  | { status: "error"; message: string };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ResultSchema = z.object({
  success: z.boolean().describe("Whether the operation was successful."),
  error: z
    .string()
    .optional()
    .describe("An error message if the operation failed."),
  // Content contains summary and optional state
  content: z
    .object({
      summary: z.string().describe("A brief summary of the action taken."),
      updatedEditorStateJson: z
        .string()
        .optional()
        .describe(
          "The full editor state serialized as JSON after the mutation.",
        ),
      // Add optional keys for newly created list structures
      listNodeKey: z
        .string()
        .optional()
        .describe("Key of the newly created ListNode (if applicable)."),
      firstItemKey: z
        .string()
        .optional()
        .describe(
          "Key of the first ListItemNode created within a new list (if applicable).",
        ),
      newNodeKey: z
        .string()
        .optional()
        .describe("Key of the newly created node (if applicable)."),
      // New fields for comment tools
      threadId: z
        .string()
        .optional()
        .describe("ID of the created/affected thread."),
      commentId: z.string().optional().describe("ID of the created comment."),
    })
    .optional()
    .describe(
      "Result content, including summary and potentially the updated editor state.",
    ),
});

// --- ENSURE SCHEMA FOR A SINGLE CALL WITHIN THE COMBINED TOOL EXISTS ---
const SingleCallSchema = z.object({
  toolName: z
    .string()
    .describe("The exact name of the tool to call (e.g., 'insertTextNode')."),
  args: z
    .any()
    .describe(
      "The arguments object for the specified tool, matching its parameters.",
    ),
});
// ---------------------------------------------------------------------

type ExecuteResult = Promise<z.infer<typeof ResultSchema>>;

/* ------------------------------------------------------------------
 * Factory
 * -----------------------------------------------------------------*/

const RuntimeToolsCtx = createContext<RuntimeToolMap | null>(null);

export function RuntimeToolsProvider({ children }: PropsWithChildren) {
  const dispatch = useChatDispatch();
  const { parseStyleString, reconstructStyleString } = useLexicalStyleUtils();
  const { searchAndInsertImage: searchAndInsertImageFunc } =
    useLexicalImageInsertion();
  const { generateAndInsertImage: generateAndInsertImageFunc } =
    useLexicalImageGeneration();
  const { submitAddComment, deleteCommentOrThread, commentStore } =
    useCommentPlugin();
  const [editor] = useLexicalComposerContext();
  const { getEditor: getRegisteredEditor } = useEditorRegistry();
  const { runtimeSpec } = useRuntimeSpec();

  function getTargetEditorInstance(editorKey?: string): LexicalEditor {
    if (editorKey) {
      return getRegisteredEditor(editorKey);
    }
    return editor;
  }

  function findNodeByKey(
    currentEditor: LexicalEditor,
    key?: string,
  ): LexicalNode | null {
    if (!key) return null;
    const node = currentEditor.getEditorState()._nodeMap.get(key);
    return node ?? null;
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
    currentEditor: LexicalEditor,
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

    // Find the target node based on the anchor
    // Note: This happens outside editor.update, so we use the editor state directly
    let target: LexicalNode | null = null;
    if (anchor.type === "key") {
      target = findNodeByKey(currentEditor, anchor.key);
    } else {
      // findFirstNodeByText needs to run within an update cycle to use $ commands
      currentEditor.getEditorState().read(() => {
        target = findFirstNodeByText(currentEditor, anchor.text);
      });
    }

    if (!target) {
      const anchorDesc =
        anchor.type === "key" ? `key "${anchor.key}"` : `text "${anchor.text}"`;
      return {
        status: "error",
        message: `Target node not found for anchor ${anchorDesc} with relation '${relation}'.`,
      };
    }

    return { status: "success", type: relation, targetKey: target.getKey() };
  }

  /* 1.  build enums / spec */
  const { NodeSpecByType } = useMemo(() => {
    // Block vs inline
    const blockTypes = runtimeSpec.nodes
      .filter((n) => !n.isInline && !n.isDecorator)
      .map((n) => n.type) as [string, ...string[]];

    const inlineTypes = runtimeSpec.nodes
      .filter((n) => n.isInline)
      .map((n) => n.type) as [string, ...string[]];

    return {
      BlockTypeE: z.enum(blockTypes),
      InlineTypeE: z.enum(inlineTypes),
      NodeSpecByType: Object.fromEntries(
        runtimeSpec.nodes.map((n) => [n.type, n]),
      ),
    };
  }, [runtimeSpec]);

  useEffect(() => {
    console.log("🛠️ [ToolFactory] NodeSpecByType changed:", NodeSpecByType);
  }, [NodeSpecByType]);

  /* --------------------------------------------------------------
   * Plan or Clarify Tool
   * --------------------------------------------------------------*/
  const requestClarificationOrPlan = tool({
    description: `Describe the steps *you* (the assistant) plan to take
          to accomplish the user's objective, phrased in the
          first person (e.g., 'First, I will...').
          However if the user's objective is unclear or ambiguous,
          you must ask for clarification including a description
          of what you can do.
          `.replaceAll("          ", ""),
    parameters: z.object({
      operation: z
        .enum(["plan", "clarify"])
        .describe("Whether to generate a plan or to ask for clarification."),
      objective: z
        .string()
        .min(20)
        .max(1500)
        .optional()
        .describe(
          "Minimum 20 characters, maximum 1500 characters. What the user wants to achieve (for plan). This must be written in first person, and be a short concise summary of the planned actions to achieve the objective.",
        ),
      clarification: z
        .string()
        .min(20)
        .max(1500)
        .optional()
        .describe(
          "Minimum 20 characters, maximum 1500 characters. A clarifying question (for clarify). This must be written in first person, and be a short concise question that will help the user clarify their objective.",
        ),
    }),
    execute: async (args): ExecuteResult => {
      switch (args.operation) {
        case "plan": {
          const planMsgId = crypto.randomUUID();
          dispatch({
            type: "push",
            msg: {
              id: planMsgId,
              role: "assistant",
              content: args.objective as string,
            },
          });
          // Non-mutating, return plan text as summary
          return {
            success: true,
            content: { summary: `Plan: ${args.objective}` },
          };
        }
        case "clarify": {
          dispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "assistant",
              content: args.clarification as string,
            },
          });
          // Failed validation essentially, return clarification as summary
          return {
            success: false,
            content: { summary: `Clarification needed: ${args.clarification}` },
          };
        }
      }
    },
  });

  /* --------------------------------------------------------------
   * Patch Node‑by‑Key Tool
   * --------------------------------------------------------------*/
  const patchNodeByJSON = tool({
    description: `Replaces a node with a JSON‑patched clone.
      Internally:
        1. exportJSON() → current shape
        2. Object.fromEntries(patchProperties) → patch
        3. { …current, …patch } → merged  (if node class supplies importJSON)
        4. Otherwise mutate the existing node in‑place via setters / direct props
        5. importJSON(merged) → new node (only for the first path)
        6. swap old ↔︎ new, keeping the same spot in the tree.`,
    parameters: z.object({
      nodeKey: z.string().describe("Key of the node to edit."),
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

    execute: async ({ nodeKey, patchProperties }): ExecuteResult => {
      try {
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (!node)
            throw new Error(`Node ${nodeKey} not found during update.`);

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

        const stateJson = JSON.stringify(editor.getEditorState().toJSON());
        return {
          success: true,
          content: {
            summary: `Patched node ${nodeKey} (properties: ${patchProperties.map((p) => p.key).join(", ")}).`,
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

  /* --------------------------------------------------------------
   * Search and Insert Image Tool
   * --------------------------------------------------------------*/
  const searchAndInsertImage = searchAndInsertImageFunc
    ? tool({
        description:
          "Searches for an image using the provided query on Unsplash and inserts the first result into the document (defaults to block).",
        parameters: z.object({
          query: z
            .string()
            .describe("The search query to find an image on Unsplash."),
        }),
        execute: async ({ query }): ExecuteResult => {
          try {
            await searchAndInsertImageFunc(query, "block");
            const summary = `Successfully searched and inserted an image related to '${query}'.`;
            // TODO: This *does* mutate state, should we return it?
            // For now, following pattern of not returning state from non-insert tools.
            return { success: true, content: { summary } };
          } catch (error) {
            console.error(
              "Error calling searchAndInsertImage function:",
              error,
            );
            const message =
              error instanceof Error
                ? error.message
                : "Unknown error occurred during image search/insertion.";
            return {
              success: false,
              error: message,
              // Provide error summary in content if needed
              content: {
                summary: `Failed to insert image for query: ${query}`,
              },
            };
          }
        },
      })
    : undefined;

  /* --------------------------------------------------------------
   * Image Generation Tool
   * --------------------------------------------------------------*/
  const generateAndInsertImage = generateAndInsertImageFunc
    ? tool({
        description:
          "Generates an image based on a user prompt and inserts it into the document.",
        parameters: z.object({
          prompt: z
            .string()
            .describe(
              "A detailed text description of the image to be generated.",
            ),
        }),
        execute: async ({ prompt }): ExecuteResult => {
          try {
            await generateAndInsertImageFunc(prompt);
            const summary = `Successfully generated and inserted an image for the prompt: "${prompt}"`;
            // TODO: This *does* mutate state, should we return it?
            // For now, following pattern of not returning state from non-insert tools.
            return { success: true, content: { summary } };
          } catch (error) {
            console.error("Error executing image generation tool:", error);
            const message =
              error instanceof Error
                ? error.message
                : "Failed to generate or insert image.";
            return {
              success: false,
              error: message,
              content: {
                summary: `Failed to generate image for prompt: ${prompt}`,
              },
            };
          }
        },
      })
    : undefined;

  /* --------------------------------------------------------------
   * Summarize Execution Tool
   * --------------------------------------------------------------*/
  const summarizeExecution = tool({
    description:
      "Reports the final summary of actions taken to the user. This MUST be called as the final step after all other actions are complete.",
    parameters: z.object({
      summaryText: z
        .string()
        .describe(
          "A concise summary, phrased in the first person, of all actions performed in the previous steps (e.g., 'I formatted block X as a heading, then I inserted image Y').",
        ),
    }),
    execute: async ({ summaryText }): ExecuteResult => {
      try {
        dispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "assistant",
            content: summaryText,
          },
        });
        // Non-mutating, return summary
        return { success: true, content: { summary: summaryText } };
      } catch (error: unknown) {
        // Need to assert error is an Error instance to access message safely
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error dispatching summary message:", message);
        return {
          success: false,
          error: `Failed to dispatch summary: ${message}`,
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert TextNode Tool
   * --------------------------------------------------------------*/
  const insertTextNode = tool({
    description:
      "Inserts a new TextNode containing the provided text. If relation is 'before' or 'after', an existing TextNode must be identified by anchorKey or anchorText. If relation is 'appendRoot', the TextNode will be wrapped in a Paragraph and appended to the document root.",
    parameters: z.object({
      text: z.string(),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({ text, relation, anchor, editorKey }): ExecuteResult => {
      try {
        console.log("[insertTextNode] Starting", { text, relation, anchor });

        const targetEditor = getTargetEditorInstance(editorKey);

        // 1. Resolve insertion point *outside* update cycle
        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertTextNode] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        // 2. Perform insertion *inside* update cycle
        let targetKey: string | null = null; // For summary
        let newNodeKey: string | null = null; // To return
        targetEditor.update(() => {
          const newTextNode = $createTextNode(text);
          newNodeKey = newTextNode.getKey(); // Store text node key initially

          if (resolution.type === "appendRoot") {
            const paragraph = $createParagraphNode();
            paragraph.append(newTextNode);
            $getRoot().append(paragraph);
            targetKey = $getRoot().getKey(); // Technically root, but signifies append
            newNodeKey = paragraph.getKey(); // Return the paragraph key for appendRoot
          } else {
            // Relative insertion ('before' or 'after')
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKey = resolution.targetKey; // For summary

            if (!targetNode) {
              // Should ideally not happen if resolution succeeded, but defensive check
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within targetEditor update.`,
              );
            }

            if ($isTextNode(targetNode)) {
              // Insert text inline relative to existing text
              if (resolution.type === "before") {
                targetNode.insertBefore(newTextNode);
              } else {
                // 'after'
                targetNode.insertAfter(newTextNode);
              }
              newNodeKey = targetNode.getKey(); // Return the text node key
            } else {
              // Insert text wrapped in a paragraph relative to other node types
              const paragraph = $createParagraphNode();
              paragraph.append(newTextNode);
              if (resolution.type === "before") {
                targetNode.insertBefore(paragraph);
              } else {
                // 'after'
                targetNode.insertAfter(paragraph);
              }
              newNodeKey = paragraph.getKey(); // Return the paragraph key
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? "Appended new paragraph containing text."
            : `Inserted text content ${resolution.type} target (key: ${targetKey ?? "N/A"}).`;
        console.log(`✅ [insertTextNode] Success: ${summary}`);
        // Return summary and state in content
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertTextNode] Error:`, errorMsg);
        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert text node",
            updatedEditorStateJson: stateJson,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert HeadingNode Tool
   * --------------------------------------------------------------*/
  const insertHeadingNode = tool({
    description:
      "Inserts a new HeadingNode with the specified tag and text. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    parameters: z.object({
      text: z.string().describe("The text content of the heading."),
      tag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      text,
      tag,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertHeadingNode] Starting", {
          text,
          tag,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertHeadingNode] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        // 2. Perform insertion *inside* update cycle
        let targetKey: string | null = null; // For summary
        let newNodeKey: string | null = null; // To return
        targetEditor.update(() => {
          const newHeadingNode = $createHeadingNode(tag).append(
            $createTextNode(text),
          );
          newNodeKey = newHeadingNode.getKey(); // Store the key

          if (resolution.type === "appendRoot") {
            $getRoot().append(newHeadingNode);
            targetKey = $getRoot().getKey();
          } else {
            // Relative insertion ('before' or 'after')
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKey = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            // Headings should always be block-level, so insert before/after the target block
            if (resolution.type === "before") {
              targetNode.insertBefore(newHeadingNode);
            } else {
              // 'after'
              targetNode.insertAfter(newHeadingNode);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new ${tag} heading.`
            : `Inserted ${tag} heading ${resolution.type} target (key: ${targetKey ?? "N/A"}).`;
        console.log(`✅ [insertHeadingNode] Success: ${summary}`);
        // Return summary and state in content
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertHeadingNode] Error:`, errorMsg);
        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert heading node",
            updatedEditorStateJson: stateJson,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert ListNode Tool
   * --------------------------------------------------------------*/
  const insertListNode = tool({
    description: `Inserts a new ListNode of the specified type 
      (bullet, number, check) containing an initial 
      ListItemNode with the provided text. 
      Uses relation and anchor to determine position.
      Rather than invoking this tool directly, multiple list nodes should be inserted with a batch.
      `,
    parameters: z.object({
      listType: ListTypeEnum,
      text: z.string().describe("Text for the initial list item."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      listType,
      text,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertListNode] Starting", {
          listType,
          text,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertListNode] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        let targetKey: string | null = null;
        let newListKey: string | null = null; // Key of the inserted list node
        let newFirstItemKey: string | null = null; // Key of the first item
        targetEditor.update(() => {
          const listItem = $createListItemNode(
            listType === "check" ? false : undefined,
          );
          listItem.append($createTextNode(text));
          const newList = $createListNode(listType);
          newList.append(listItem);

          // Store keys
          newListKey = newList.getKey();
          newFirstItemKey = listItem.getKey();

          if (resolution.type === "appendRoot") {
            $getRoot().append(newList);
            targetKey = $getRoot().getKey();
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKey = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            if (resolution.type === "before") {
              targetNode.insertBefore(newList);
            } else {
              // 'after'
              targetNode.insertAfter(newList);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new ${listType} list.`
            : `Inserted ${listType} list ${resolution.type} target (key: ${targetKey ?? "N/A"}).`;
        console.log(`✅ [insertListNode] Success: ${summary}`);
        // Return summary, state, and NEW KEYS in content
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            listNodeKey: newListKey ?? undefined,
            firstItemKey: newFirstItemKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertListNode] Error:`, errorMsg);
        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert list node",
            updatedEditorStateJson: stateJson,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert ListItemNode Tool
   * --------------------------------------------------------------*/
  const insertListItemNode = tool({
    description:
      "Inserts a new ListItemNode with the provided text. For 'before' or 'after' relations, the anchor MUST resolve to an existing ListItemNode. For 'appendToList' relation, the anchor MUST resolve to an existing ListNode.",
    parameters: z.object({
      text: z.string(),
      relation: z
        .enum(["before", "after", "appendToList"])
        .describe(
          "'before'/'after' relative to an existing ListItemNode; 'appendToList' adds to the end of the specified ListNode.",
        ),
      anchor: ListItemAnchorSchema, // anchor is required
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({ text, relation, anchor, editorKey }): ExecuteResult => {
      try {
        console.log("[insertListItemNode] Starting", {
          text,
          relation,
          anchor,
        });

        let targetKey: string | null = null;
        let targetType: string | null = null;
        let listType: ListType | undefined;
        let checkValue: boolean | undefined;
        let validationError: string | null = null;

        const targetEditor = getTargetEditorInstance(editorKey);

        // --- Resolve anchor and perform validation INSIDE editor.read ---
        targetEditor.read(() => {
          let resolvedTargetNode: LexicalNode | null = null;
          if (anchor.type === "key") {
            // Find node by key directly within read
            resolvedTargetNode = $getNodeByKey(anchor.key);
          } else {
            // Find node by text directly within read
            resolvedTargetNode = findFirstNodeByText(targetEditor, anchor.text);
            // Try finding parent list/item if initial find is not one
            if (
              resolvedTargetNode &&
              !$isListItemNode(resolvedTargetNode) &&
              !$isListNode(resolvedTargetNode)
            ) {
              const parent = resolvedTargetNode.getParent();
              if ($isListNode(parent)) {
                resolvedTargetNode = parent;
              } else {
                let searchNode: LexicalNode | null = resolvedTargetNode;
                while (searchNode && !$isRootNode(searchNode)) {
                  if ($isListItemNode(searchNode)) {
                    resolvedTargetNode = searchNode;
                    break;
                  }
                  searchNode = searchNode.getParent();
                }
                // If still not list/listitem, might be null or the original node
              }
            }
          }

          // --- Validation ---
          if (!resolvedTargetNode) {
            const anchorDesc =
              anchor.type === "key"
                ? `key "${anchor.key}"`
                : `text "${anchor.text}"`;
            validationError = `Anchor node ${anchorDesc} not found.`;
            return; // Exit read block early on error
          }

          targetKey = resolvedTargetNode.getKey(); // Store key
          targetType = resolvedTargetNode.getType(); // Store type

          if (relation === "appendToList") {
            if (!$isListNode(resolvedTargetNode)) {
              validationError = `Anchor must resolve to a ListNode for relation 'appendToList', but found ${targetType}.`;
              return; // Exit read block early on error
            }
            listType = resolvedTargetNode.getListType();
            checkValue = listType === "check" ? false : undefined;
          } else {
            // 'before' or 'after'
            if (!$isListItemNode(resolvedTargetNode)) {
              validationError = `Anchor must resolve to a ListItemNode for relation '${relation}', but found ${targetType}.`;
              return; // Exit read block early on error
            }
            checkValue =
              typeof resolvedTargetNode.getChecked() === "boolean"
                ? false
                : undefined;
          }
        }); // --- End editor.read ---

        // Check if validation failed within the read block
        if (validationError) {
          console.error(
            `❌ [insertListItemNode] Validation Error: ${validationError}`,
          );
          return { success: false, error: validationError };
        }

        // Ensure targetKey was set (should be if no validation error)
        if (!targetKey) {
          throw new Error("Target key was not set after validation.");
        }

        // --- Perform update using validated data ---
        const finalTargetKey = targetKey; // Use a const variable inside update closure
        targetEditor.update(() => {
          const resolvedTarget = $getNodeByKey(finalTargetKey);
          if (!resolvedTarget) {
            // This error implies the node was removed between read and update, which is rare but possible
            throw new Error(
              `Target node ${finalTargetKey} disappeared between validation and update.`,
            );
          }

          const newListItem = $createListItemNode(checkValue);
          newListItem.append($createTextNode(text));

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
            // This state should be unreachable due to prior validation
            throw new Error(
              `Invalid state: Cannot insert list item with relation '${relation}' relative to node type ${resolvedTarget.getType()} after validation. Target Key: ${finalTargetKey}`,
            );
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary = `Inserted list item ${relation} target (key: ${finalTargetKey}).`;
        console.log(`✅ [insertListItemNode] Success: ${summary}`);
        // Return summary and state in content
        return {
          success: true,
          content: { summary, updatedEditorStateJson: stateJson },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertListItemNode] Error:`, errorMsg);
        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert list item",
            updatedEditorStateJson: stateJson,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert CodeBlock Tool
   * --------------------------------------------------------------*/
  const insertCodeBlock = tool({
    description:
      "Inserts a new CodeNode (code block). Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. Can optionally set the language and initial text content.",
    parameters: z.object({
      language: z
        .string()
        .optional()
        .describe(
          "Optional language identifier (e.g., 'javascript', 'python').",
        ),
      initialText: z
        .string()
        .optional()
        .describe("Optional initial text content for the code block."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      language,
      initialText,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertCodeBlock] Starting", {
          language,
          initialText,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertCodeBlock] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        // 2. Perform insertion *inside* update cycle
        let targetKey: string | null = null; // For summary
        let newCodeNodeKey: string | null = null; // For result content
        targetEditor.update(() => {
          // Create the CodeNode - language might be set via a method if not constructor
          const newCodeNode = $createCodeNode();
          // Safely check for and call setLanguage if it exists
          if (language) {
            if (
              "setLanguage" in newCodeNode &&
              typeof newCodeNode.setLanguage === "function"
            ) {
              newCodeNode.setLanguage(language);
            } else {
              console.warn(
                `[insertCodeBlock] Could not set language '${language}' on CodeNode. Method setLanguage might not exist or is not callable.`,
              );
            }
          }

          // Add initial text if provided
          if (initialText) {
            newCodeNode.append($createTextNode(initialText));
          }
          newCodeNodeKey = newCodeNode.getKey(); // Store the new key

          if (resolution.type === "appendRoot") {
            $getRoot().append(newCodeNode);
            targetKey = $getRoot().getKey();
          } else {
            // Relative insertion ('before' or 'after')
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKey = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            // Insert the code block before/after the target block
            if (resolution.type === "before") {
              targetNode.insertBefore(newCodeNode);
            } else {
              // 'after'
              targetNode.insertAfter(newCodeNode);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new Code Block${language ? ` (${language})` : ""}.`
            : `Inserted Code Block${language ? ` (${language})` : ""} ${resolution.type} target (key: ${targetKey ?? "N/A"}).`;
        console.log(`✅ [insertCodeBlock] Success: ${summary}`);
        // Return summary, state, and new node key
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newCodeNodeKey ?? undefined, // Optional: Return the key (null -> undefined)
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertCodeBlock] Error:`, errorMsg);
        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert code block",
            updatedEditorStateJson: stateJson,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert CodeHighlightNode Tool
   * --------------------------------------------------------------*/
  const insertCodeHighlightNode = tool({
    description:
      "Inserts a new CodeHighlightNode containing the provided text. This node is a special TextNode that will be highlighted if it is within a CodeNode. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    parameters: z.object({
      text: z.string().describe("The text content for the CodeHighlightNode."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({ text, relation, anchor, editorKey }): ExecuteResult => {
      try {
        console.log("[insertCodeHighlightNode] Starting", {
          text,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(
            `❌ [insertCodeHighlightNode] Error: ${resolution.message}`,
          );
          return { success: false, error: resolution.message };
        }

        // 2. Perform insertion *inside* update cycle
        let targetKey: string | null = null; // For summary
        let newNodeKey: string | null = null; // To return
        targetEditor.update(() => {
          const newHighlightNode = $createCodeHighlightNode(text);
          newNodeKey = newHighlightNode.getKey(); // Store highlight node key initially

          if (resolution.type === "appendRoot") {
            const paragraph = $createParagraphNode();
            paragraph.append(newHighlightNode);
            $getRoot().append(paragraph);
            targetKey = $getRoot().getKey(); // Technically root, but signifies append
            newNodeKey = paragraph.getKey(); // Return the paragraph key for appendRoot
          } else {
            // Relative insertion ('before' or 'after')
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKey = resolution.targetKey; // For summary

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            if ($isTextNode(targetNode) || $isCodeHighlightNode(targetNode)) {
              // Insert highlight node inline relative to existing text or highlight node
              if (resolution.type === "before") {
                targetNode.insertBefore(newHighlightNode);
              } else {
                // 'after'
                targetNode.insertAfter(newHighlightNode);
              }
              // newNodeKey remains the highlight node's key (set initially)
            } else {
              // Insert highlight node wrapped in a paragraph relative to other node types
              const paragraph = $createParagraphNode();
              paragraph.append(newHighlightNode);
              if (resolution.type === "before") {
                targetNode.insertBefore(paragraph);
              } else {
                // 'after'
                targetNode.insertAfter(paragraph);
              }
              newNodeKey = paragraph.getKey(); // Return the paragraph key
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? "Appended new paragraph containing a CodeHighlightNode."
            : `Inserted CodeHighlightNode ${resolution.type} target (key: ${targetKey ?? "N/A"}).`;
        console.log(`✅ [insertCodeHighlightNode] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertCodeHighlightNode] Error:`, errorMsg);
        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert CodeHighlightNode",
            updatedEditorStateJson: stateJson,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert Markdown Tool
   * --------------------------------------------------------------*/
  const insertMarkdown = tool({
    description:
      "Inserts content parsed from a Markdown string. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. This is efficient for inserting complex structures like multiple paragraphs, lists, headings, code blocks, etc., defined in Markdown format.",
    parameters: z.object({
      markdownText: z
        .string()
        .describe("The Markdown content to parse and insert."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      markdownText,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertMarkdown] Starting", {
          markdownText,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(
            `❌ [insertMarkdown] Error resolving insertion point: ${resolution.message}`,
          );
          return { success: false, error: resolution.message };
        }

        // 2. Perform insertion *inside* update cycle
        let targetKeyForSummary: string | null =
          resolution.type === "appendRoot"
            ? "root"
            : resolution.status === "success"
              ? resolution.targetKey
              : null;

        targetEditor.update(
          () => {
            let targetNodeForConversion: ElementNode | null = null;

            if (resolution.type === "appendRoot") {
              // For appendRoot, create a new paragraph at the end and use it as the target node.
              const newParagraph = $createParagraphNode();
              $getRoot().append(newParagraph);
              targetNodeForConversion = newParagraph; // Target the new paragraph directly
              targetKeyForSummary = newParagraph.getKey(); // Update summary key to the new node
              console.log(
                "[insertMarkdown] Mode: appendRoot - created target paragraph:",
                targetKeyForSummary,
              );
            } else {
              // Relative insertion ('before' or 'after')
              // We already checked resolution.status !== 'error'
              const targetNodeKey = (resolution as { targetKey: string })
                .targetKey;
              const targetNode = $getNodeByKey(targetNodeKey);

              if (!targetNode) {
                throw new Error(
                  `Target node with key ${targetNodeKey} not found within editor update.`,
                );
              }

              const targetBlock = targetNode.getTopLevelElement() ?? targetNode;
              if (
                !targetBlock ||
                !$isElementNode(targetBlock) ||
                targetBlock.isInline()
              ) {
                throw new Error(
                  `Target node (key: ${targetNodeKey}) or its top-level element is not a valid block node for relative insertion.`,
                );
              }

              // Create a paragraph node to hold the converted content.
              const insertionPointNode = $createParagraphNode();
              targetNodeForConversion = insertionPointNode; // Target this new node

              if (resolution.type === "before") {
                targetBlock.insertBefore(insertionPointNode);
                console.log(
                  `[insertMarkdown] Mode: before ${targetNodeKey} - inserted target paragraph:`,
                  insertionPointNode.getKey(),
                );
              } else {
                // 'after'
                targetBlock.insertAfter(insertionPointNode);
                console.log(
                  `[insertMarkdown] Mode: after ${targetNodeKey} - inserted target paragraph:`,
                  insertionPointNode.getKey(),
                );
              }
            }

            // Ensure we have a node to target for conversion
            if (!targetNodeForConversion) {
              // This should be unreachable if logic above is correct
              throw new Error(
                "Failed to determine target node for Markdown conversion.",
              );
            }

            // Perform the conversion, passing the target node explicitly
            // This should replace the content *of* targetNodeForConversion
            console.log(
              `[insertMarkdown] Calling $convertFromMarkdownString, targeting node: ${targetNodeForConversion.getKey()}`,
            );
            $convertFromMarkdownString(
              markdownText,
              TRANSFORMERS,
              targetNodeForConversion,
            );

            // If the conversion resulted in an empty target node (e.g., empty markdown string), remove it.
            // Need to get a fresh instance as conversion might replace the node object.
            const potentiallyEmptyNode = $getNodeByKey(
              targetNodeForConversion.getKey(),
            );
            if (
              potentiallyEmptyNode &&
              $isElementNode(potentiallyEmptyNode) &&
              potentiallyEmptyNode.isAttached() &&
              potentiallyEmptyNode.isEmpty()
            ) {
              console.log(
                `[insertMarkdown] Conversion target node ${potentiallyEmptyNode.getKey()} is empty, removing it.`,
              );
              potentiallyEmptyNode.remove();
            }
          },
          { tag: "llm-insert-markdown" },
        ); // Add a tag for debugging history

        // Capture state *after* the update completes
        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended content from Markdown.`
            : `Inserted content from Markdown ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertMarkdown] Success: ${summary}`);

        // Return summary and state in content
        return {
          success: true,
          content: { summary, updatedEditorStateJson: stateJson },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertMarkdown] Error:`, errorMsg);
        // Capture state even on error if possible
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
        } catch (stateErr) {
          console.error("Failed to serialize state on error:", stateErr);
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert content from Markdown",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert Table Tool
   * --------------------------------------------------------------*/
  const insertTable = tool({
    description:
      "Inserts a new TableNode with the specified number of rows and columns, populating it with empty cells. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    parameters: z.object({
      rows: z.number().min(1).describe("The number of rows for the table."),
      columns: z
        .number()
        .min(1)
        .describe("The number of columns for the table."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      rows,
      columns,
      relation,
      anchor,
      editorKey,
    }: {
      rows: number;
      columns: number;
      relation: InsertionRelation;
      anchor?: InsertionAnchor;
      editorKey?: string;
    }): ExecuteResult => {
      try {
        console.log("[insertTableNode - corrected] Starting", {
          rows,
          columns,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(
            `❌ [insertTableNode - corrected] Error: ${resolution.message}`,
          );
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let newTableNodeKey: string | null = null;

        targetEditor.update(() => {
          const newTable = $createTableNode(); // Create an empty table
          newTableNodeKey = newTable.getKey();

          // Populate the table with rows and cells
          for (let i = 0; i < rows; i++) {
            const tableRow = $createTableRowNode();
            for (let j = 0; j < columns; j++) {
              const tableCell = $createTableCellNode();
              // Add a paragraph with an empty text node or line break to make cells editable
              const paragraph = $createParagraphNode();
              // Option 1: Empty Text Node (often preferred)
              paragraph.append($createTextNode(""));
              // Option 2: LineBreakNode (can also work)
              // paragraph.append($createLineBreakNode());
              tableCell.append(paragraph);
              tableRow.append(tableCell);
            }
            newTable.append(tableRow);
          }

          if (resolution.type === "appendRoot") {
            $getRoot().append(newTable);
            targetKeyForSummary = $getRoot().getKey();
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            if (resolution.type === "before") {
              targetNode.insertBefore(newTable);
            } else {
              targetNode.insertAfter(newTable);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new ${rows}x${columns} table.`
            : `Inserted ${rows}x${columns} table ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertTableNode - corrected] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newTableNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertTableNode - corrected] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
        } catch (stateErr) {
          console.error("Failed to serialize state on error:", stateErr);
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert table node",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert HashtagNode Tool
   * --------------------------------------------------------------*/
  const insertHashtag = tool({
    description:
      "Inserts a new HashtagNode with the provided text. If relation is 'appendRoot' or the anchor is block-level, it's wrapped in a ParagraphNode.",
    parameters: z.object({
      text: z
        .string()
        .describe(
          "The text content of the hashtag (e.g., 'lexical', 'important').",
        ),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      text,
      relation,
      anchor,
      editorKey,
    }: {
      text: string;
      relation: InsertionRelation;
      anchor?: InsertionAnchor;
      editorKey?: string;
    }): ExecuteResult => {
      try {
        console.log("[insertHashtagNode] Starting", { text, relation, anchor });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertHashtagNode] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let finalInsertedNodeKey: string | null = null;

        targetEditor.update(() => {
          const newHashtagNode = $createHashtagNode(text);

          if (resolution.type === "appendRoot") {
            const paragraph = $createParagraphNode();
            paragraph.append(newHashtagNode);
            $getRoot().append(paragraph);
            targetKeyForSummary = $getRoot().getKey();
            finalInsertedNodeKey = paragraph.getKey(); // Key of the wrapper paragraph
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            // Check if target is suitable for inline insertion (e.g., TextNode, or even another HashtagNode)
            // Or if the target is a block node that can accept a paragraph as a child.
            if (
              $isTextNode(targetNode) ||
              $isHashtagNode(targetNode) /* Add other inline types if needed */
            ) {
              // Insert inline
              if (resolution.type === "before") {
                targetNode.insertBefore(newHashtagNode);
              } else {
                // 'after'
                targetNode.insertAfter(newHashtagNode);
              }
              finalInsertedNodeKey = newHashtagNode.getKey(); // Key of the hashtag node itself
            } else {
              // Target is likely a block node, or something else where direct inline insertion isn't appropriate.
              // Wrap the HashtagNode in a paragraph.
              const paragraph = $createParagraphNode();
              paragraph.append(newHashtagNode);
              if (resolution.type === "before") {
                targetNode.insertBefore(paragraph);
              } else {
                // 'after'
                targetNode.insertAfter(paragraph);
              }
              finalInsertedNodeKey = paragraph.getKey(); // Key of the wrapper paragraph
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new paragraph containing hashtag '#${text}'.`
            : `Inserted hashtag '#${text}' ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertHashtagNode] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: finalInsertedNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertHashtagNode] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
        } catch (stateErr) {
          console.error("Failed to serialize state on error:", stateErr);
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert hashtag node",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Remove Node Tool
   * --------------------------------------------------------------*/
  const removeNode = tool({
    description: "Removes a node from the document using its key.",
    parameters: z.object({
      nodeKey: z.string().describe("The key of the node to remove."),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({ nodeKey, editorKey }): ExecuteResult => {
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
    execute: async ({
      nodeKey,
      anchorKey,
      relation,
      editorKey,
    }): ExecuteResult => {
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

  /* --------------------------------------------------------------
   * Apply Text Style Tool
   * --------------------------------------------------------------*/
  const applyTextStyle = tool({
    description:
      "Applies specific CSS styles (like font family, size, color) to an existing TextNode identified by its key. Provide style values as strings (e.g., 'Arial, sans-serif', '14px', '#FF0000'). To remove a specific style, provide an empty string ('') for its value.",
    parameters: z.object({
      anchorKey: z.string().describe("The key of the target TextNode."),
      editorKey: EditorKeySchema.optional(),
      fontFamily: z
        .string()
        .optional()
        .describe(
          "CSS font-family value (e.g., 'Arial, sans-serif'). Empty string ('') removes.",
        ),
      fontSize: z
        .string()
        .optional()
        .describe(
          "CSS font-size value (e.g., '14px', '1.2em'). Empty string ('') removes.",
        ),
      color: z
        .string()
        .optional()
        .describe(
          "CSS color value (e.g., '#FF0000', 'blue'). Empty string ('') removes.",
        ),
      backgroundColor: z
        .string()
        .optional()
        .describe("CSS background-color value. Empty string ('') removes."),
      // Add other common style properties as needed (fontWeight, fontStyle, textDecoration)
    }),
    execute: async ({
      anchorKey,
      editorKey,
      fontFamily,
      fontSize,
      color,
      backgroundColor,
    }): ExecuteResult => {
      try {
        console.log("[applyTextStyle] Starting", {
          anchorKey,
          fontFamily,
          fontSize,
          color,
          backgroundColor,
        });
        let success = false;
        let finalSummary = "";
        let errorMsg: string | null = null;

        const targetEditor = getTargetEditorInstance(editorKey);

        targetEditor.update(() => {
          const targetNode = $getNodeByKey(anchorKey);

          if (!targetNode) {
            errorMsg = `Target node with key ${anchorKey} not found.`;
            return;
          }

          if (!$isTextNode(targetNode)) {
            errorMsg = `Target node (key: ${anchorKey}) is type '${targetNode.getType()}', but styles can only be applied to TextNodes.`;
            return;
          }

          // Get current styles and parse them
          let styleObj = parseStyleString(targetNode.getStyle());
          const appliedStyles: string[] = [];

          // Helper to update style object and track changes
          const updateStyle = (key: string, value: string | undefined) => {
            if (value === undefined) return; // Skip if parameter wasn't provided

            if (value === "") {
              if (key in styleObj) {
                // Check if key exists before attempting removal
                // Linter-friendly removal: create new object excluding the key
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { [key]: _, ...rest } = styleObj;
                styleObj = rest;
                appliedStyles.push(`removed ${key}`);
              }
            } else {
              if (styleObj[key] !== value) {
                styleObj[key] = value;
                appliedStyles.push(`set ${key}=${value}`);
              }
            }
          };

          // Apply updates for each provided parameter
          updateStyle("font-family", fontFamily);
          updateStyle("font-size", fontSize);
          updateStyle("color", color);
          updateStyle("background-color", backgroundColor);
          // Add calls for other style properties here

          if (appliedStyles.length === 0) {
            finalSummary = `No style changes needed for TextNode (key: ${anchorKey}).`;
            success = true; // Considered success as no change was necessary
            return;
          }

          // Reconstruct and set the new style string
          const newStyleString = reconstructStyleString(styleObj);
          targetNode.setStyle(newStyleString);

          finalSummary = `Applied styles to TextNode (key: ${anchorKey}): ${appliedStyles.join(", ")}.`;
          success = true;
        }); // --- End editor.update ---

        if (errorMsg) {
          console.error(`❌ [applyTextStyle] Error: ${errorMsg}`);
          return { success: false, error: errorMsg };
        }

        // Return result based on update outcome
        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        console.log(
          `✅ [applyTextStyle] ${success ? "Success" : "No changes"}: ${finalSummary}`,
        );
        return {
          success: success, // True if styles were changed or no change was needed
          content: { summary: finalSummary, updatedEditorStateJson: stateJson },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [applyTextStyle] Error:`, errorMsg);
        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to apply text style",
            updatedEditorStateJson: stateJson,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Send Reply Tool (Non-mutating)
   * --------------------------------------------------------------*/
  const sendReply = tool({
    description:
      "Sends a text-only reply to the user. Use this when the user's query clearly does not require document modification, such as asking a question or making a comment.",
    parameters: z.object({
      replyText: z
        .string()
        .describe("The text content of the reply to send to the user."),
    }),
    execute: async ({ replyText }): ExecuteResult => {
      try {
        dispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "assistant",
            content: replyText,
          },
        });
        // Non-mutating, simple success
        return { success: true, content: { summary: "Reply sent." } };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error dispatching reply message:", message);
        return {
          success: false,
          error: `Failed to dispatch reply: ${message}`,
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert LinkNode Tool
   * --------------------------------------------------------------*/
  const insertLinkNode = tool({
    description:
      "Inserts a new LinkNode with the provided URL and optional text. If linkText is not provided, the URL itself will be used as the visible text. The LinkNode is inline; if inserted at the root or relative to a block-level node, it will be wrapped in a ParagraphNode.",
    parameters: z.object({
      url: z
        .string()
        .describe("The URL for the link (e.g., 'https://example.com')."),
      linkText: z
        .string()
        .optional()
        .describe(
          "The visible text for the link. Defaults to the URL if not provided.",
        ),
      attributes: z
        .object({
          rel: z
            .string()
            .optional()
            .describe(
              "The 'rel' attribute for the link (e.g., 'noopener noreferrer').",
            ),
          target: z
            .string()
            .optional()
            .describe("The 'target' attribute for the link (e.g., '_blank')."),
          title: z
            .string()
            .optional()
            .describe("The 'title' attribute for the link."),
        })
        .optional()
        .describe("Optional HTML attributes for the link."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      url,
      linkText,
      attributes,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertLinkNode] Starting", {
          url,
          linkText,
          attributes,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertLinkNode] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let finalInsertedNodeKey: string | null = null; // Key of the LinkNode or its wrapper Paragraph

        targetEditor.update(() => {
          const actualLinkText = linkText || url;
          const newLinkNode = $createLinkNode(url, attributes);
          newLinkNode.append($createTextNode(actualLinkText));

          if (resolution.type === "appendRoot") {
            const paragraph = $createParagraphNode();
            paragraph.append(newLinkNode);
            $getRoot().append(paragraph);
            targetKeyForSummary = $getRoot().getKey();
            finalInsertedNodeKey = paragraph.getKey(); // Wrapper paragraph
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            if (
              $isTextNode(targetNode) ||
              ($isElementNode(targetNode) && targetNode.isInline())
            ) {
              if (resolution.type === "before") {
                targetNode.insertBefore(newLinkNode);
              } else {
                // 'after'
                targetNode.insertAfter(newLinkNode);
              }
              finalInsertedNodeKey = newLinkNode.getKey(); // The LinkNode itself
            } else {
              const paragraph = $createParagraphNode();
              paragraph.append(newLinkNode);
              if (resolution.type === "before") {
                targetNode.insertBefore(paragraph);
              } else {
                // 'after'
                targetNode.insertAfter(paragraph);
              }
              finalInsertedNodeKey = paragraph.getKey(); // Wrapper paragraph
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new paragraph containing a link to '${url}'.`
            : `Inserted link to '${url}' ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertLinkNode] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: finalInsertedNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertLinkNode] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (stateErr) {
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert link node",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert EquationNode Tool
   * --------------------------------------------------------------*/
  const insertEquationNode = tool({
    description:
      "Inserts a new EquationNode with the provided LaTeX equation string. Can be inline or block-level. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    parameters: z.object({
      equation: z
        .string()
        .describe("The LaTeX equation string (e.g., 'E=mc^2')."),
      inline: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Whether the equation should be inline (renders as span) or block (renders as div). Defaults to false (block).",
        ),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      equation,
      inline,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertEquationNode] Starting", {
          equation,
          inline,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertEquationNode] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let finalInsertedNodeKey: string | null = null; // Key of the EquationNode or its wrapper Paragraph

        targetEditor.update(() => {
          const newEquationNode = EquationNode.$createEquationNode(
            equation,
            inline,
          ); // Use the static method from EquationNode.tsx

          if (resolution.type === "appendRoot") {
            targetKeyForSummary = $getRoot().getKey();
            if (inline) {
              const paragraph = $createParagraphNode();
              paragraph.append(newEquationNode);
              $getRoot().append(paragraph);
              finalInsertedNodeKey = paragraph.getKey(); // Wrapper paragraph
            } else {
              $getRoot().append(newEquationNode);
              finalInsertedNodeKey = newEquationNode.getKey(); // EquationNode itself
            }
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            if (inline) {
              // Inline equation handling: similar to LinkNode or TextNode
              if (
                $isTextNode(targetNode) ||
                ($isElementNode(targetNode) && targetNode.isInline())
              ) {
                if (resolution.type === "before") {
                  targetNode.insertBefore(newEquationNode);
                } else {
                  // 'after'
                  targetNode.insertAfter(newEquationNode);
                }
                finalInsertedNodeKey = newEquationNode.getKey(); // The EquationNode itself
              } else {
                // Target is block-level, wrap inline equation in a paragraph
                const paragraph = $createParagraphNode();
                paragraph.append(newEquationNode);
                if (resolution.type === "before") {
                  targetNode.insertBefore(paragraph);
                } else {
                  // 'after'
                  targetNode.insertAfter(paragraph);
                }
                finalInsertedNodeKey = paragraph.getKey(); // Wrapper paragraph
              }
            } else {
              // Block equation handling: similar to CodeBlock
              if (resolution.type === "before") {
                targetNode.insertBefore(newEquationNode);
              } else {
                // 'after'
                targetNode.insertAfter(newEquationNode);
              }
              finalInsertedNodeKey = newEquationNode.getKey(); // EquationNode itself
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new ${inline ? "inline" : "block"} equation.`
            : `Inserted ${inline ? "inline" : "block"} equation ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertEquationNode] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: finalInsertedNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertEquationNode] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (stateErr) {
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert equation node",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert FigmaNode Tool
   * --------------------------------------------------------------*/
  const insertFigmaNode = tool({
    description:
      "Inserts a Figma embed using the provided Figma document ID. FigmaNode is a block-level element. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. Optionally, a format (e.g., 'center') can be applied.",
    parameters: z.object({
      documentID: z
        .string()
        .describe(
          "The document ID of the Figma file (extracted from its URL).",
        ),
      format: z
        .enum(["left", "center", "right", "justify"])
        .optional()
        .describe("Optional alignment format for the Figma embed."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      documentID,
      format,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertFigmaNode] Starting", {
          documentID,
          format,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertFigmaNode] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let newNodeKey: string | null = null;

        targetEditor.update(() => {
          const newFigmaNode = FigmaNode.$createFigmaNode(documentID); // Use static method from FigmaNode.tsx
          if (format) {
            newFigmaNode.setFormat(format);
          }
          newNodeKey = newFigmaNode.getKey();

          if (resolution.type === "appendRoot") {
            $getRoot().append(newFigmaNode);
            targetKeyForSummary = $getRoot().getKey();
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            // FigmaNode is block-level
            if (resolution.type === "before") {
              targetNode.insertBefore(newFigmaNode);
            } else {
              // 'after'
              targetNode.insertAfter(newFigmaNode);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new Figma embed (ID: ${documentID}).`
            : `Inserted Figma embed (ID: ${documentID}) ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertFigmaNode] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertFigmaNode] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (stateErr) {
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert Figma embed",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert CollapsibleSection Tool
   * --------------------------------------------------------------*/
  const insertCollapsibleSection = tool({
    description:
      "Inserts a new collapsible section (container, title, and content). Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    parameters: z.object({
      titleText: z.string().describe("The text for the collapsible title."),
      initialContentMarkdown: z
        .string()
        .optional()
        .describe(
          "Optional Markdown content for the collapsible body. If empty, an empty paragraph is created.",
        ),
      initiallyOpen: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether the section is open by default. Defaults to false."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      titleText,
      initialContentMarkdown,
      initiallyOpen,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertCollapsibleSection] Starting", {
          titleText,
          initialContentMarkdown,
          initiallyOpen,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          editor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(
            `❌ [insertCollapsibleSection] Error: ${resolution.message}`,
          );
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let newNodeKey: string | null = null; // Key of the CollapsibleContainerNode

        targetEditor.update(() => {
          // 1. Create the container
          const containerNode =
            CollapsibleContainerNode.$createCollapsibleContainerNode(
              initiallyOpen ?? false,
            );
          newNodeKey = containerNode.getKey();

          // 2. Create the title
          const titleNode = CollapsibleTitleNode.$createCollapsibleTitleNode();
          const titleParagraph = $createParagraphNode();
          titleParagraph.append($createTextNode(titleText));
          titleNode.append(titleParagraph);

          // 3. Create the content
          const contentNode =
            CollapsibleContentNode.$createCollapsibleContentNode();
          if (initialContentMarkdown && initialContentMarkdown.trim() !== "") {
            $convertFromMarkdownString(
              initialContentMarkdown,
              TRANSFORMERS,
              contentNode,
            );
            if (contentNode.isEmpty()) {
              // If markdown was empty or only whitespace, add a paragraph
              contentNode.append($createParagraphNode());
            }
          } else {
            contentNode.append($createParagraphNode()); // Default empty paragraph
          }

          // 4. Assemble the structure
          containerNode.append(titleNode);
          containerNode.append(contentNode);

          // 5. Insert the container
          if (resolution.type === "appendRoot") {
            $getRoot().append(containerNode);
            targetKeyForSummary = $getRoot().getKey();
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }
            if (resolution.type === "before") {
              targetNode.insertBefore(containerNode);
            } else {
              // 'after'
              targetNode.insertAfter(containerNode);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new collapsible section titled '${titleText}'.`
            : `Inserted collapsible section titled '${titleText}' ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertCollapsibleSection] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertCollapsibleSection] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (stateErr) {
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert collapsible section",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert Excalidraw diagram from Mermaid schema
   * --------------------------------------------------------------*/
  const DEFAULT_EXCALIDRAW_CFG: Required<ExcalidrawConfig> = {
    fontSize: 20,
  };

  const DEFAULT_CANVAS_WIDTH: number | "inherit" = "inherit";
  const DEFAULT_CANVAS_HEIGHT: number | "inherit" = "inherit";

  const insertExcalidrawDiagram = tool({
    description: `Parses a Mermaid DSL string into an Excalidraw canvas and inserts it at the desired location.  
        – Fully supports \`MermaidConfig\` (theme variables, edge limits, etc.).  
        – Supports \`ExcalidrawConfig\` (font sizing).`,
    parameters: z
      .object({
        mermaidLines: z
          .array(z.string())
          .describe(
            `A list of Mermaid DSL strings. 
            For ER diagrams, use the \`insertMermaidSvg\` tool instead.
            Example: [
            "graph TD",
            "  User([User]) -->|HTTPS| BrowserUI[Browser UI (Frontend)]",
            "  BrowserUI -->|API Calls| APIServer[API Server (Backend)]",
            "  …"
          ]`,
          )
          .nonempty("Mermaid definition must not be empty."),
        mermaidConfig: z
          .object({}) // allow any shape – full validation happens at runtime merge
          .passthrough()
          .optional(),
        excalidrawConfig: z
          .object({ fontSize: z.number().optional() })
          .passthrough()
          .optional(),
        width: z
          .union([z.number().min(100), z.literal("inherit")])
          .describe(
            "Optional. The width of the Excalidraw canvas. If 'inherit', the width will be determined by the parent container. Minimum width is 100px.",
          )
          .optional()
          .default(DEFAULT_CANVAS_WIDTH),
        height: z
          .union([z.number().min(100), z.literal("inherit")])
          .describe(
            "Optional. The height of the Excalidraw canvas. If 'inherit', the height will be determined by the parent container. Minimum height is 100px.",
          )
          .optional()
          .default(DEFAULT_CANVAS_HEIGHT),
        relation: InsertionRelationSchema,
        anchor: InsertionAnchorSchema.optional(),
        editorKey: EditorKeySchema.optional(),
      })
      .transform(({ mermaidLines, ...rest }) => ({
        ...rest,
        mermaid: mermaidLines.join("\n"),
      })),
    execute: async ({
      mermaid,
      mermaidConfig,
      excalidrawConfig,
      width,
      height,
      relation,
      anchor,
      editorKey,
    }) => {
      // -------------------- Merge / validate configuration -------------------
      const mermaidCfg: MermaidConfig = {
        ...(mermaidConfig ?? {}),
      };

      const excaliCfg: ExcalidrawConfig = {
        ...DEFAULT_EXCALIDRAW_CFG,
        ...(excalidrawConfig ?? {}),
      };

      // -------------------------- Parse Mermaid ----------------------------
      let parseResult: MermaidToExcalidrawResult;
      try {
        parseResult = await parseMermaidToExcalidraw(mermaid, mermaidCfg);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `Mermaid parsing failed: ${msg}`,
        } as const;
      }

      // ------------------ Convert to Excalidraw elements ------------------
      const elements = convertToExcalidrawElements(parseResult.elements, {
        regenerateIds: true,
        ...excaliCfg,
      });
      // NOTE: convertToExcalidrawElements already returns a *flat* element
      // array – perfect for a single‑canvas Excalidraw JSON.

      const excaliData = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "mermaid‑to‑excalidraw@latest",
        elements,
        files: parseResult.files ?? {},
      });

      const targetEditor = getTargetEditorInstance(editorKey);

      const resolution = await resolveInsertionPoint(
        targetEditor,
        relation,
        anchor,
      );
      if (resolution.status === "error") {
        return { success: false, error: resolution.message } as const;
      }

      // --------------------------- Perform insert --------------------------
      let newNodeKey: string | null = null;
      editor.update(() => {
        const node = new ExcalidrawNode(
          excaliData,
          false /** keep closed by default */,
          width ?? DEFAULT_CANVAS_WIDTH,
          height ?? DEFAULT_CANVAS_HEIGHT,
        );
        newNodeKey = node.getKey();

        if (resolution.type === "appendRoot") {
          $getRoot().append(node);
        } else {
          const target = $getNodeByKey(resolution.targetKey);
          if (!target)
            throw new Error(`Target node ${resolution.targetKey} vanished.`);
          if (resolution.type === "before") target.insertBefore(node);
          else target.insertAfter(node);
        }
      });

      // ----------------------------- Return -------------------------------
      const stateJson = JSON.stringify(editor.getEditorState().toJSON());
      return {
        success: true,
        content: {
          summary: `Inserted Mermaid diagram as a single Excalidraw canvas (${elements.length} elements).`,
          updatedEditorStateJson: stateJson,
          newNodeKey: newNodeKey ?? undefined,
        },
      } as const;
    },
  });

  /* --------------------------------------------------------------
   * Insert Mermaid ER Diagram Tool
   * --------------------------------------------------------------*/
  const insertMermaidDiagram = tool({
    description:
      "Insert a Mermaid diagram using the custom MermaidNode (schema only, no SVG in state).",
    parameters: z
      .object({
        mermaidLines: z.array(z.string()).nonempty(),
        width: z
          .union([z.number().min(100), z.literal("inherit")])
          .optional()
          .default("inherit"),
        height: z
          .union([z.number().min(100), z.literal("inherit")])
          .optional()
          .default("inherit"),
        relation: InsertionRelationSchema,
        anchor: InsertionAnchorSchema.optional(),
        editorKey: EditorKeySchema.optional(),
      })
      .transform(({ mermaidLines, ...rest }) => ({
        ...rest,
        schema: mermaidLines.join("\n"),
      })),
    execute: async ({ schema, width, height, relation, anchor, editorKey }) => {
      /* ------------ 1 · locate insertion point -------------------- */
      const targetEditor = getTargetEditorInstance(editorKey);

      const resolution = await resolveInsertionPoint(
        targetEditor,
        relation,
        anchor,
      );
      if (resolution.status === "error") {
        return { success: false, error: resolution.message };
      }

      /* ------------ 2 · create & insert MermaidNode --------------- */
      let nodeKey: string | undefined;
      editor.update(() => {
        const mermaidNode = MermaidNode.$createMermaidNode(
          schema,
          width,
          height,
        );
        nodeKey = mermaidNode.getKey();

        if (resolution.type === "appendRoot") {
          $getRoot().append(mermaidNode);
        } else {
          const target = $getNodeByKey(resolution.targetKey);
          if (!target) {
            throw new Error(`Target node ${resolution.targetKey} vanished.`);
          }
          if (resolution.type === "before") {
            target.insertBefore(mermaidNode);
          } else {
            target.insertAfter(mermaidNode);
          }
        }
      });

      /* ------------ 3 · return updated editor state --------------- */
      const stateJson = JSON.stringify(editor.getEditorState().toJSON());
      return {
        success: true,
        content: {
          summary: `Inserted Mermaid diagram (${width}×${height}).`,
          updatedEditorStateJson: stateJson,
          newNodeKey: nodeKey,
        },
      };
    },
  });

  /* --------------------------------------------------------------
   * Insert Layout Tool
   * --------------------------------------------------------------*/
  const insertLayout = tool({
    description:
      "Inserts a new layout container with a specified column structure. Each column (LayoutItemNode) will be initialized with an empty paragraph. The number of columns is determined by the space-separated values in templateColumns (e.g., '1fr 1fr' creates two columns). Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    parameters: z.object({
      templateColumns: z
        .string()
        .describe(
          "A CSS grid-template-columns string (e.g., '1fr 1fr', '30% 70%'). Space-separated values determine the number of columns.",
        ),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      templateColumns,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertLayout] Starting", {
          templateColumns,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertLayout] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let newNodeKey: string | null = null; // Key of the LayoutContainerNode

        targetEditor.update(() => {
          // 1. Create the container
          const containerNode =
            LayoutContainerNode.$createLayoutContainerNode(templateColumns);
          newNodeKey = containerNode.getKey();

          // 2. Determine number of columns and create items
          const columnDefinitions = templateColumns
            .split(" ")
            .filter((def) => def.trim() !== "");
          const numberOfColumns = columnDefinitions.length;

          if (numberOfColumns === 0) {
            // Avoid creating a layout with no columns, though templateColumns schema should prevent empty string ideally.
            // Or, default to a single column if that's preferred behavior for empty/invalid input.
            // For now, let's assume valid input means at least one column definition.
            // If needed, add a paragraph directly to the container or throw error.
            const emptyParagraph = $createParagraphNode();
            containerNode.append(emptyParagraph); // Fallback: add one empty paragraph to make it usable
          } else {
            for (let i = 0; i < numberOfColumns; i++) {
              const itemNode = LayoutItemNode.$createLayoutItemNode();
              const paragraphNode = $createParagraphNode();
              itemNode.append(paragraphNode);
              containerNode.append(itemNode);
            }
          }

          // 3. Insert the container
          if (resolution.type === "appendRoot") {
            $getRoot().append(containerNode);
            targetKeyForSummary = $getRoot().getKey();
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }
            if (resolution.type === "before") {
              targetNode.insertBefore(containerNode);
            } else {
              // 'after'
              targetNode.insertAfter(containerNode);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new layout with columns: ${templateColumns}.`
            : `Inserted layout with columns: ${templateColumns} ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertLayout] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertLayout] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (stateErr) {
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert layout",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert PageBreakNode Tool
   * --------------------------------------------------------------*/
  const insertPageBreakNode = tool({
    description:
      "Inserts a new PageBreakNode. This is a block-level element that typically forces a page break when printing or exporting to PDF. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    parameters: z.object({
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({ relation, anchor, editorKey }): ExecuteResult => {
      try {
        console.log("[insertPageBreakNode] Starting", { relation, anchor });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(
            `❌ [insertPageBreakNode] Error: ${resolution.message}`,
          );
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let newNodeKey: string | null = null;

        targetEditor.update(() => {
          const newPageBreak = PageBreakNode.$createPageBreakNode();
          newNodeKey = newPageBreak.getKey();

          if (resolution.type === "appendRoot") {
            $getRoot().append(newPageBreak);
            targetKeyForSummary = $getRoot().getKey();
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            // PageBreakNode is block-level
            if (resolution.type === "before") {
              targetNode.insertBefore(newPageBreak);
            } else {
              // 'after'
              targetNode.insertAfter(newPageBreak);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? "Appended new Page Break."
            : `Inserted Page Break ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertPageBreakNode] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertPageBreakNode] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (stateErr) {
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert Page Break",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert PollNode Tool
   * --------------------------------------------------------------*/
  const insertPollNode = tool({
    description:
      "Inserts a new PollNode with a question and a list of option texts. Each option text will be converted into a poll option with a unique ID and an empty vote count. PollNode is a block-level element. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    parameters: z.object({
      question: z.string().describe("The question for the poll."),
      optionTexts: z
        .array(z.string())
        .min(1)
        .describe(
          "An array of strings, where each string is the text for a poll option. Must have at least one option.",
        ),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      question,
      optionTexts,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertPollNode] Starting", {
          question,
          optionTexts,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertPollNode] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let newNodeKey: string | null = null;

        targetEditor.update(() => {
          const options = optionTexts.map((text) =>
            PollNode.createPollOption(text),
          );
          const newPollNode = PollNode.$createPollNode(question, options);
          newNodeKey = newPollNode.getKey();

          if (resolution.type === "appendRoot") {
            $getRoot().append(newPollNode);
            targetKeyForSummary = $getRoot().getKey();
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            // PollNode is treated as block-level for insertion
            if (resolution.type === "before") {
              targetNode.insertBefore(newPollNode);
            } else {
              // 'after'
              targetNode.insertAfter(newPollNode);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new poll: "${question}".`
            : `Inserted poll: "${question}" ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertPollNode] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertPollNode] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (stateErr) {
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert poll",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert TweetNode Tool
   * --------------------------------------------------------------*/
  const insertTweetNode = tool({
    description:
      "Inserts a Tweet embed using the provided Tweet ID. TweetNode is a block-level element. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. Optionally, an alignment format can be applied.",
    parameters: z.object({
      tweetID: z
        .string()
        .regex(/^\d+$/, "Tweet ID must be a string of digits.")
        .describe("The ID of the Tweet (the numerical part of its URL)."),
      format: z
        .enum(["left", "center", "right", "justify"])
        .optional()
        .describe("Optional alignment format for the Tweet embed."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      tweetID,
      format,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertTweetNode] Starting", {
          tweetID,
          format,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertTweetNode] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let newNodeKey: string | null = null;

        targetEditor.update(() => {
          const newTweetNode = TweetNode.$createTweetNode(tweetID);
          if (format) {
            newTweetNode.setFormat(format);
          }
          newNodeKey = newTweetNode.getKey();

          if (resolution.type === "appendRoot") {
            $getRoot().append(newTweetNode);
            targetKeyForSummary = $getRoot().getKey();
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            // TweetNode is block-level
            if (resolution.type === "before") {
              targetNode.insertBefore(newTweetNode);
            } else {
              // 'after'
              targetNode.insertAfter(newTweetNode);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new Tweet embed (ID: ${tweetID}).`
            : `Inserted Tweet embed (ID: ${tweetID}) ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertTweetNode] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertTweetNode] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (stateErr) {
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert Tweet embed",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert YouTubeNode Tool
   * --------------------------------------------------------------*/
  const insertYouTubeNode = tool({
    description:
      "Inserts a YouTube video embed using the provided video ID. YouTubeNode is a block-level element. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. Optionally, an alignment format can be applied.",
    parameters: z.object({
      videoID: z
        .string()
        .describe(
          "The ID of the YouTube video (from its URL, e.g., dQw4w9WgXcQ).",
        ),
      format: z
        .enum(["left", "center", "right", "justify"])
        .optional()
        .describe("Optional alignment format for the YouTube video embed."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      videoID,
      format,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertYouTubeNode] Starting", {
          videoID,
          format,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(`❌ [insertYouTubeNode] Error: ${resolution.message}`);
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let newNodeKey: string | null = null;

        targetEditor.update(() => {
          const newYouTubeNode = YouTubeNode.$createYouTubeNode(videoID);
          if (format) {
            newYouTubeNode.setFormat(format);
          }
          newNodeKey = newYouTubeNode.getKey();

          if (resolution.type === "appendRoot") {
            $getRoot().append(newYouTubeNode);
            targetKeyForSummary = $getRoot().getKey();
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            // YouTubeNode is block-level
            if (resolution.type === "before") {
              targetNode.insertBefore(newYouTubeNode);
            } else {
              // 'after'
              targetNode.insertAfter(newYouTubeNode);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? `Appended new YouTube video embed (ID: ${videoID}).`
            : `Inserted YouTube video embed (ID: ${videoID}) ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertYouTubeNode] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertYouTubeNode] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (stateErr) {
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert YouTube video embed",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Insert SlideDeckNode Tool
   * --------------------------------------------------------------*/
  const insertSlideDeckNode = tool({
    description:
      "Inserts a new SlideDeckNode. SlideDeckNode is a block-level element. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. Optionally, initial slide data can be provided as a JSON string.",
    parameters: z.object({
      initialDataJSON: z
        .string()
        .optional()
        .describe(
          "Optional JSON string of SlideDeckData. If not provided, uses default slide deck data.",
        ),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      initialDataJSON,
      relation,
      anchor,
      editorKey,
    }): ExecuteResult => {
      try {
        console.log("[insertSlideDeckNode] Starting", {
          initialDataJSON,
          relation,
          anchor,
        });

        const targetEditor = getTargetEditorInstance(editorKey);

        const resolution = await resolveInsertionPoint(
          targetEditor,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(
            `❌ [insertSlideDeckNode] Error: ${resolution.message}`,
          );
          return { success: false, error: resolution.message };
        }

        let targetKeyForSummary: string | null = null;
        let newNodeKey: string | null = null;

        targetEditor.update(() => {
          let slideData: SlideDeckData;
          if (initialDataJSON) {
            try {
              slideData = JSON.parse(initialDataJSON) as SlideDeckData;
            } catch (e) {
              console.warn(
                "[insertSlideDeckNode] Failed to parse initialDataJSON, using default data.",
                e,
              );
              slideData = DEFAULT_SLIDE_DECK_DATA;
            }
          } else {
            slideData = DEFAULT_SLIDE_DECK_DATA;
          }

          const newSlideDeckNode = SlideNode.$createSlideNode(slideData);
          newNodeKey = newSlideDeckNode.getKey();

          if (resolution.type === "appendRoot") {
            $getRoot().append(newSlideDeckNode);
            targetKeyForSummary = $getRoot().getKey();
          } else {
            const targetNode = $getNodeByKey(resolution.targetKey);
            targetKeyForSummary = resolution.targetKey;

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update.`,
              );
            }

            // SlideDeckNode is block-level
            if (resolution.type === "before") {
              targetNode.insertBefore(newSlideDeckNode);
            } else {
              // 'after'
              targetNode.insertAfter(newSlideDeckNode);
            }
          }
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const summary =
          resolution.type === "appendRoot"
            ? "Appended new Slide Deck."
            : `Inserted Slide Deck ${resolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertSlideDeckNode] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newNodeKey ?? undefined,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertSlideDeckNode] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (stateErr) {
          /* ignore */
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert Slide Deck",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Find and Select Text Tool
   * --------------------------------------------------------------*/
  const findAndSelectTextForComment = tool({
    description:
      "Finds the first occurrence of the specified text in the document and selects it. Subsequent tool calls for 'addCommentThread' will use this selection.",
    parameters: z.object({
      textToFind: z
        .string()
        .min(1)
        .describe("The exact text to find and select in the document."),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({ textToFind, editorKey }): ExecuteResult => {
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
    parameters: z.object({
      initialCommentText: z
        .string()
        .describe("The text for the first comment in this new thread."),
      authorName: z
        .string()
        .optional()
        .describe("Author name for the comment. Defaults to 'AI Assistant'."),
      threadNodePlacementRelation: InsertionRelationSchema.optional()
        .default("appendRoot")
        .describe(
          "Relation for placing the ThreadNode (decorator) in the document structure.",
        ),
      threadNodePlacementAnchor: InsertionAnchorSchema.optional().describe(
        "Anchor for placing the ThreadNode (decorator) in the document structure.",
      ),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      initialCommentText,
      authorName,
      threadNodePlacementRelation,
      threadNodePlacementAnchor,
      editorKey,
    }): ExecuteResult => {
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
        const resolution = await resolveInsertionPoint(
          targetEditor,
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
        const stateJson = JSON.stringify(latestState.toJSON());
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
    parameters: z.object({
      threadId: z.string().describe("The ID of the thread to reply to."),
      replyText: z.string().describe("The text content of the reply."),
      authorName: z
        .string()
        .optional()
        .describe("Author name for the reply. Defaults to 'AI Assistant'."),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({
      threadId,
      replyText,
      authorName,
      editorKey,
    }): ExecuteResult => {
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
        const stateJson = JSON.stringify(latestState.toJSON());
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
    parameters: z.object({
      threadId: z.string().describe("The ID of the parent thread."),
      commentId: z.string().describe("The ID of the comment to remove."),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({ threadId, commentId, editorKey }): ExecuteResult => {
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
        const stateJson = JSON.stringify(latestState.toJSON());
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
    parameters: z.object({
      threadId: z.string().describe("The ID of the comment thread to remove."),
    }),
    execute: async ({ threadId }): ExecuteResult => {
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
        const stateJson = JSON.stringify(latestState.toJSON());
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

  /* --------------------------------------------------------------
   * Add Slide Page Tool
   * --------------------------------------------------------------*/
  const addSlidePage = tool({
    description:
      "Adds a new, empty slide page to an existing SlideDeckNode. This tool only modifies the slide structure, not the content of any slide.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      newSlideId: z
        .string()
        .optional()
        .describe(
          "Optional ID for the new slide. If not provided, a unique ID (e.g., 'slide-<timestamp>') will be generated.",
        ),
      insertionIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Optional 0-based index at which to insert the new slide. If undefined or out of bounds, the slide is appended to the end.",
        ),
      focusNewSlide: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "If true (default), the 'currentSlideId' of the deck will be set to the ID of the newly added slide.",
        ),
      backgroundColor: z
        .string()
        .optional()
        .describe(
          "Optional background color for the new slide (e.g., '#FF0000', 'blue'). Defaults to transparent/white.",
        ),
    }),
    execute: async ({
      deckNodeKey,
      newSlideId,
      insertionIndex,
      focusNewSlide,
      backgroundColor,
    }): ExecuteResult => {
      try {
        let summary = "";
        let updatedDeckData: SlideDeckData | null = null;

        editor.update(() => {
          const deckNode = $getNodeByKey<SlideNode>(deckNodeKey);
          if (!SlideNode.$isSlideDeckNode(deckNode)) {
            throw new Error(
              `Node with key ${deckNodeKey} is not a valid SlideDeckNode.`,
            );
          }

          const currentDeckData = deckNode.getData();
          const newId = newSlideId || `slide-${Date.now()}`;
          const newPage: SlideData = {
            id: newId,
            elements: [],
            backgroundColor: backgroundColor,
          };

          const newSlides = [...currentDeckData.slides];
          let actualInsertionIndex = insertionIndex;

          if (
            actualInsertionIndex === undefined ||
            actualInsertionIndex < 0 ||
            actualInsertionIndex > newSlides.length
          ) {
            actualInsertionIndex = newSlides.length; // Append to end
          }
          newSlides.splice(actualInsertionIndex, 0, newPage);

          const finalDeckData: SlideDeckData = {
            ...currentDeckData,
            slides: newSlides,
            currentSlideId: focusNewSlide
              ? newId
              : currentDeckData.currentSlideId,
          };
          deckNode.setData(finalDeckData);
          updatedDeckData = finalDeckData;
          summary = `Added new slide page (ID: ${newId}) to deck ${deckNodeKey} at index ${actualInsertionIndex}.`;
          if (focusNewSlide) {
            summary += ` Focused new slide.`;
          }
        });

        if (!updatedDeckData) {
          // Should not happen if update runs
          throw new Error("Failed to update slide deck data.");
        }

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        console.log(`✅ [addSlidePage] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: deckNodeKey,
          }, // deckNodeKey as newNodeKey as the deck itself was modified
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [addSlidePage] Error:`, errorMsg);
        return { success: false, error: errorMsg };
      }
    },
  });

  /* --------------------------------------------------------------
   * Remove Slide Page Tool
   * --------------------------------------------------------------*/
  const removeSlidePage = tool({
    description:
      "Removes a specific slide page from an existing SlideDeckNode. This tool only modifies the slide structure, not the content of any slide. Cannot remove the last slide.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      slideIdToRemove: z
        .string()
        .describe("The ID of the slide page to remove."),
    }),
    execute: async ({ deckNodeKey, slideIdToRemove }): ExecuteResult => {
      try {
        let summary = "";
        let updatedDeckData: SlideDeckData | null = null;

        editor.update(() => {
          const deckNode = $getNodeByKey<SlideNode>(deckNodeKey);
          if (!SlideNode.$isSlideDeckNode(deckNode)) {
            throw new Error(
              `Node with key ${deckNodeKey} is not a valid SlideDeckNode.`,
            );
          }

          const currentDeckData = deckNode.getData();
          if (currentDeckData.slides.length <= 1) {
            throw new Error("Cannot remove the last slide from a deck.");
          }

          const slideToRemoveIndex = currentDeckData.slides.findIndex(
            (s) => s.id === slideIdToRemove,
          );

          if (slideToRemoveIndex === -1) {
            throw new Error(
              `Slide with ID ${slideIdToRemove} not found in deck ${deckNodeKey}.`,
            );
          }

          const newSlides = currentDeckData.slides.filter(
            (s) => s.id !== slideIdToRemove,
          );

          let newCurrentSlideId = currentDeckData.currentSlideId;
          if (currentDeckData.currentSlideId === slideIdToRemove) {
            if (newSlides.length > 0) {
              // Focus previous or the new first slide
              const newFocusIndex = Math.max(0, slideToRemoveIndex - 1);
              newCurrentSlideId = newSlides[newFocusIndex]?.id ?? null;
              if (!newCurrentSlideId && newSlides[0]?.id) {
                // Should always find one if newSlides not empty
                newCurrentSlideId = newSlides[0].id;
              }
            } else {
              // This case should be prevented by the "length <= 1" check,
              // but as a fallback, if somehow all slides are gone (which is an error state).
              newCurrentSlideId = null;
            }
          }

          const finalDeckData: SlideDeckData = {
            ...currentDeckData,
            slides: newSlides,
            currentSlideId: newCurrentSlideId,
          };
          deckNode.setData(finalDeckData);
          updatedDeckData = finalDeckData;
          summary = `Removed slide page (ID: ${slideIdToRemove}) from deck ${deckNodeKey}.`;
          if (
            currentDeckData.currentSlideId === slideIdToRemove &&
            newCurrentSlideId
          ) {
            summary += ` New current slide is ${newCurrentSlideId}.`;
          } else if (
            currentDeckData.currentSlideId === slideIdToRemove &&
            !newCurrentSlideId
          ) {
            summary += ` Current slide focus cleared (should not happen if slides remain).`;
          }
        });

        if (!updatedDeckData) {
          throw new Error("Failed to update slide deck data during removal.");
        }

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        console.log(`✅ [removeSlidePage] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: deckNodeKey,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [removeSlidePage] Error:`, errorMsg);
        return { success: false, error: errorMsg };
      }
    },
  });

  /* --------------------------------------------------------------
   * Reorder Slide Page Tool
   * --------------------------------------------------------------*/
  const reorderSlidePage = tool({
    description:
      "Reorders a slide page within an existing SlideDeckNode. This tool only modifies the slide structure, not the content of any slide.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      slideIdToMove: z
        .string()
        .describe("The ID of the slide page to reorder."),
      newIndex: z
        .number()
        .int()
        .min(0)
        .describe(
          "The new 0-based index for the slide. The slide will be moved to this position.",
        ),
    }),
    execute: async ({
      deckNodeKey,
      slideIdToMove,
      newIndex,
    }): ExecuteResult => {
      try {
        let summary = "";
        let updatedDeckData: SlideDeckData | null = null;

        editor.update(() => {
          const deckNode = $getNodeByKey<SlideNode>(deckNodeKey);
          if (!SlideNode.$isSlideDeckNode(deckNode)) {
            throw new Error(
              `Node with key ${deckNodeKey} is not a valid SlideDeckNode.`,
            );
          }

          const currentDeckData = deckNode.getData();
          const slideToMove = currentDeckData.slides.find(
            (s) => s.id === slideIdToMove,
          );

          if (!slideToMove) {
            throw new Error(
              `Slide with ID ${slideIdToMove} not found in deck ${deckNodeKey}.`,
            );
          }

          const tempSlides = currentDeckData.slides.filter(
            (s) => s.id !== slideIdToMove,
          );

          // Clamp newIndex to be within the bounds of the modified array
          const actualNewIndex = Math.max(
            0,
            Math.min(newIndex, tempSlides.length),
          );

          tempSlides.splice(actualNewIndex, 0, slideToMove);

          const finalDeckData: SlideDeckData = {
            ...currentDeckData,
            slides: tempSlides,
            // currentSlideId remains unchanged by reordering
          };
          deckNode.setData(finalDeckData);
          updatedDeckData = finalDeckData;
          summary = `Reordered slide page (ID: ${slideIdToMove}) in deck ${deckNodeKey} to new index ${actualNewIndex}.`;
        });

        if (!updatedDeckData) {
          throw new Error("Failed to update slide deck data during reorder.");
        }

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        console.log(`✅ [reorderSlidePage] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: deckNodeKey,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [reorderSlidePage] Error:`, errorMsg);
        return { success: false, error: errorMsg };
      }
    },
  });

  /* --------------------------------------------------------------
   * Set Slide Page Background Tool
   * --------------------------------------------------------------*/
  const setSlidePageBackground = tool({
    description:
      "Sets the background color of a specific slide page within a SlideDeckNode.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      slideTarget: z
        .union([
          z.object({ type: z.literal("id"), slideId: z.string() }),
          z.object({
            type: z.literal("index"),
            slideIndex: z.number().int().min(0),
          }),
        ])
        .describe("Identifier for the target slide (by ID or index)."),
      backgroundColor: z
        .string()
        .describe(
          "The new background color for the slide (e.g., '#FF0000', 'blue').",
        ),
    }),
    execute: async ({
      deckNodeKey,
      slideTarget,
      backgroundColor,
    }): ExecuteResult => {
      try {
        let summary = "";
        let updatedDeckData: SlideDeckData | null = null;

        editor.update(() => {
          const deckNode = $getNodeByKey<SlideNode>(deckNodeKey);
          if (!SlideNode.$isSlideDeckNode(deckNode)) {
            throw new Error(
              `Node with key ${deckNodeKey} is not a valid SlideDeckNode.`,
            );
          }

          const currentDeckData = deckNode.getData();
          let targetSlideIndex = -1;

          if (slideTarget.type === "id") {
            targetSlideIndex = currentDeckData.slides.findIndex(
              (s) => s.id === slideTarget.slideId,
            );
            if (targetSlideIndex === -1) {
              throw new Error(
                `Slide with ID ${slideTarget.slideId} not found in deck ${deckNodeKey}.`,
              );
            }
          } else {
            targetSlideIndex = slideTarget.slideIndex;
            if (
              targetSlideIndex < 0 ||
              targetSlideIndex >= currentDeckData.slides.length
            ) {
              throw new Error(
                `Slide index ${targetSlideIndex} is out of bounds for deck ${deckNodeKey}. Number of slides: ${currentDeckData.slides.length}`,
              );
            }
          }

          const targetSlide = currentDeckData.slides[targetSlideIndex];
          if (!targetSlide) {
            throw new Error(
              `Target slide at index ${targetSlideIndex} could not be retrieved for deck ${deckNodeKey}.`,
            );
          }

          const updatedSlideData = {
            ...targetSlide,
            backgroundColor: backgroundColor,
          };

          const newSlides = [...currentDeckData.slides];
          newSlides[targetSlideIndex] = updatedSlideData;

          const finalDeckData = { ...currentDeckData, slides: newSlides };
          deckNode.setData(finalDeckData);
          updatedDeckData = finalDeckData;
          summary = `Set background color of slide ${slideTarget.type === "id" ? slideTarget.slideId : `index ${targetSlideIndex}`} in deck ${deckNodeKey} to ${backgroundColor}.`;
        });

        if (!updatedDeckData) {
          throw new Error(
            "Failed to update slide deck data after setting background color.",
          );
        }

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        console.log(`✅ [setSlidePageBackground] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: deckNodeKey,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [setSlidePageBackground] Error:`, errorMsg);
        return { success: false, error: errorMsg };
      }
    },
  });

  /* --------------------------------------------------------------
   * Add Box to Slide Page Tool
   * --------------------------------------------------------------*/
  const addBoxToSlidePage = tool({
    description:
      "Adds a new box element to a specific slide page within an existing SlideDeckNode. The content for the box should be provided as Markdown.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      slideId: z
        .string()
        .describe("The ID of the slide page to add the box to."),
      initialTextContent: z
        .string()
        .optional()
        .describe(
          "The initial text content for the box. A single paragraph will be created.",
        ),
      boxId: z
        .string()
        .optional()
        .describe(
          "Optional ID for the new box. If not provided, a unique ID (e.g., 'box-<timestamp>') will be generated.",
        ),
      x: z
        .number()
        .optional()
        .default(50)
        .describe(
          "Optional X coordinate for the top-left corner of the box. Defaults to 50. The slide itself is 1280px wide.",
        ),
      y: z
        .number()
        .optional()
        .default(50)
        .describe(
          "Optional Y coordinate for the top-left corner of the box. Defaults to 50. The slide itself is 720px tall.",
        ),
      width: z
        .number()
        .optional()
        .default(300)
        .describe("Optional width of the box. Defaults to 300. The slide itself is 1280px wide."),
      height: z
        .number()
        .optional()
        .default(150)
        .describe("Optional height of the box. Defaults to 150. The slide itself is 720px tall."),
      backgroundColor: z
        .string()
        .optional()
        .default("transparent")
        .describe(
          "Optional background color for the box (e.g., '#FF0000', 'blue'). Defaults to transparent.",
        ),
    }),
    execute: async ({
      deckNodeKey,
      slideId,
      initialTextContent,
      boxId,
      x,
      y,
      width,
      height,
      backgroundColor,
    }): ExecuteResult => {
      try {
        let summary = "";
        let newBoxGeneratedId: string | undefined;

        // Create a simple EditorStateJSON: root > paragraph > text
        // If initialTextContent is null, undefined, or an empty string,
        // an empty text node will be created, which is valid.
        const textForNode = initialTextContent || "";

        const generatedEditorStateJSON: EditorStateJSON = {
          root: {
            type: "root",
            version: 1,
            direction: null,
            format: "",
            indent: 0,
            children: [
              {
                type: "paragraph",
                version: 1,
                direction: null,
                format: "",
                indent: 0,
                children: [
                  {
                    type: "text",
                    version: 1,
                    text: textForNode,
                    detail: 0,
                    format: "0",
                    mode: "normal",
                    style: "",
                    direction: null,
                    indent: 0,
                  },
                ],
              },
            ],
          },
        } satisfies EditorStateJSON;

        editor.update(() => {
          const deckNode = $getNodeByKey<SlideNode>(deckNodeKey);
          if (!SlideNode.$isSlideDeckNode(deckNode)) {
            throw new Error(
              `Node with key ${deckNodeKey} is not a valid SlideDeckNode.`,
            );
          }
          const currentDeckData = deckNode.getData();
          const targetSlideIndex = currentDeckData.slides.findIndex(
            (s) => s.id === slideId,
          );

          if (targetSlideIndex === -1) {
            throw new Error(
              `Slide with ID ${slideId} not found in deck ${deckNodeKey}.`,
            );
          }

          newBoxGeneratedId = boxId || `box-${Date.now()}`;
          const newBoxElement: SlideElementSpec = {
            kind: "box",
            id: newBoxGeneratedId,
            x: x || 50,
            y: y || 50,
            width: width || 300,
            height: height || 150,
            editorStateJSON: generatedEditorStateJSON,
            backgroundColor: backgroundColor || "transparent",
            version: 1,
          };

          const updatedSlides = currentDeckData.slides.map((slide, index) => {
            if (index === targetSlideIndex) {
              return {
                ...slide,
                elements: [...(slide.elements || []), newBoxElement],
              };
            }
            return slide;
          });

          const finalDeckData: SlideDeckData = {
            ...currentDeckData,
            slides: updatedSlides,
          };
          deckNode.setData(finalDeckData);
          summary = `Added new box (ID: ${newBoxGeneratedId}) with text content to slide ${slideId} in deck ${deckNodeKey}.`;
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        console.log(`✅ [addBoxToSlidePage] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
            newNodeKey: newBoxGeneratedId,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [addBoxToSlidePage] Error:`, errorMsg, err);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
        } catch (stateErr) {
          console.error(
            "[addBoxToSlidePage] Failed to serialize state on error:",
            stateErr,
          );
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to add box to slide page",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * Update Box Properties on Slide Page Tool
   * --------------------------------------------------------------*/
  const updateBoxPropertiesOnSlidePage = tool({
    description:
      "Updates the properties (like position, size, background color) of an existing box element on a specific slide page.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      slideId: z
        .string()
        .describe("The ID of the slide page containing the box."),
      boxId: z.string().describe("The ID of the box element to update."),
      properties: z
        .object({
          x: z.number().optional(),
          y: z.number().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          backgroundColor: z.string().optional(),
        })
        .describe(
          "An object containing the properties to update. Only provided properties will be changed.",
        ),
    }),
    execute: async ({
      deckNodeKey,
      slideId,
      boxId,
      properties,
    }): ExecuteResult => {
      try {
        let summary = "";

        editor.update(() => {
          const deckNode = $getNodeByKey<SlideNode>(deckNodeKey);
          if (!SlideNode.$isSlideDeckNode(deckNode)) {
            throw new Error(
              `Node with key ${deckNodeKey} is not a valid SlideDeckNode.`,
            );
          }

          const currentDeckData = deckNode.getData();
          const targetSlideIndex = currentDeckData.slides.findIndex(
            (s) => s.id === slideId,
          );

          if (targetSlideIndex === -1) {
            throw new Error(
              `Slide with ID ${slideId} not found in deck ${deckNodeKey}.`,
            );
          }

          let boxFoundAndUpdated = false;
          const updatedSlides = currentDeckData.slides.map((slide, index) => {
            if (index === targetSlideIndex) {
              const newElements = (slide.elements || []).map((el) => {
                if (el.id === boxId && el.kind === "box") {
                  boxFoundAndUpdated = true;
                  return {
                    ...el,
                    ...properties, // Spread the new properties
                    version: (el.version || 0) + 1,
                  };
                }
                return el;
              });
              return { ...slide, elements: newElements };
            }
            return slide;
          });

          if (!boxFoundAndUpdated) {
            throw new Error(
              `Box with ID ${boxId} not found on slide ${slideId} in deck ${deckNodeKey}.`,
            );
          }

          const finalDeckData: SlideDeckData = {
            ...currentDeckData,
            slides: updatedSlides,
          };
          deckNode.setData(finalDeckData);
          summary = `Updated properties of box (ID: ${boxId}) on slide ${slideId} in deck ${deckNodeKey}. Changed: ${Object.keys(properties).join(", ")}`;
        });

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());
        console.log(`✅ [updateBoxPropertiesOnSlidePage] Success: ${summary}`);
        return {
          success: true,
          content: {
            summary,
            updatedEditorStateJson: stateJson,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [updateBoxPropertiesOnSlidePage] Error:`, errorMsg);
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
        } catch (stateErr) {
          console.error(
            "[updateBoxPropertiesOnSlidePage] Failed to serialize state on error:",
            stateErr,
          );
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to update box properties on slide page",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  const individualTools = {
    ...(patchNodeByJSON && { patchNodeByJSON }),
    ...(insertTextNode && { insertTextNode }),
    ...(insertHeadingNode && { insertHeadingNode }),
    ...(insertLinkNode && { insertLinkNode }),
    ...(insertEquationNode && { insertEquationNode }),
    ...(insertFigmaNode && { insertFigmaNode }),
    ...(insertCollapsibleSection && { insertCollapsibleSection }),
    ...(insertExcalidrawDiagram && {
      insertExcalidrawDiagram: insertExcalidrawDiagram,
    }),
    ...(insertMermaidDiagram && { insertMermaidDiagram }),
    ...(insertLayout && { insertLayout }),
    ...(insertPageBreakNode && { insertPageBreakNode }),
    ...(insertPollNode && { insertPollNode }),
    ...(insertTweetNode && { insertTweetNode }),
    ...(insertYouTubeNode && { insertYouTubeNode }),
    ...(insertSlideDeckNode && { insertSlideDeckNode }),
    ...(addSlidePage && { addSlidePage }),
    ...(removeSlidePage && { removeSlidePage }),
    ...(reorderSlidePage && { reorderSlidePage }),
    ...(addBoxToSlidePage && { addBoxToSlidePage }), // Register the new tool
    ...(setSlidePageBackground && { setSlidePageBackground }),
    ...(insertListNode && { insertListNode }),
    ...(insertListItemNode && { insertListItemNode }),
    ...(insertCodeBlock && { insertCodeBlock }),
    ...(insertCodeHighlightNode && { insertCodeHighlightNode }),
    ...(insertMarkdown && { insertMarkdown }),
    ...(insertTable && { insertTable }),
    ...(insertHashtag && { insertHashtag }),
    ...(applyTextStyle && { applyTextStyle }),
    ...(removeNode && { removeNode }),
    ...(moveNode && { moveNode }),
    ...(requestClarificationOrPlan && { requestClarificationOrPlan }),
    ...(summarizeExecution && { summarizeExecution }),
    ...(searchAndInsertImage && { searchAndInsertImage }),
    ...(generateAndInsertImage && { generateAndInsertImage }),
    ...(sendReply && { sendReply }),
    ...(addCommentThread && { addCommentThread }),
    ...(addReplyToThread && { addReplyToThread }),
    ...(findAndSelectTextForComment && {
      findAndSelectTextForComment: findAndSelectTextForComment,
    }),
    ...(removeCommentFromThread && { removeCommentFromThread }),
    ...(removeCommentThread && { removeCommentThread }),
    ...(updateBoxPropertiesOnSlidePage && { updateBoxPropertiesOnSlidePage }),
  } as unknown as RuntimeToolMap;

  /* --------------------------------------------------------------
   * Combined Tools Wrapper
   * --------------------------------------------------------------*/
  const combinedTools = tool({
    description: `Executes a sequence of other tool calls sequentially. 
        Useful for batching independent or safely sequential operations to reduce latency. 
        Stops execution if any step fails.
        Should prefferably be used when inserting multiple similar nodes.
        `,
    parameters: z.object({
      calls: z
        .array(SingleCallSchema)
        .min(1)
        .describe(
          "An array of tool calls to execute in order. Each object needs 'toolName' and 'args'.",
        ),
    }),
    execute: async ({ calls }): ExecuteResult => {
      const results: { summary: string; stateJson?: string }[] = [];
      let lastStateJson: string | undefined;

      try {
        console.log(
          `[combinedTools] Starting execution of ${calls.length} calls.`,
        );

        for (let i = 0; i < calls.length; i++) {
          const call = calls[i];
          if (!call) {
            throw new Error(`[combinedTools] Invalid call at index ${i}`);
          }
          const { toolName, args } = call;

          console.log(
            `[combinedTools] Executing step ${i + 1}: ${toolName}`,
            args,
          );

          // Find the tool in the preliminary map (using closure for 'individualTools')
          const subTool = individualTools[toolName]; // Corrected: individualTools should be in scope here

          if (!subTool) {
            const errorMsg = `[combinedTools] Error: Tool '${toolName}' not found. Available tools: ${Object.keys(individualTools).join(", ")}`;
            console.error(errorMsg);
            return { success: false, error: errorMsg };
          }

          // Check if execute is a function before calling
          if (typeof subTool.execute !== "function") {
            const errorMsg = `[combinedTools] Error: Tool '${toolName}' does not have a callable execute function.`;
            console.error(errorMsg);
            return { success: false, error: errorMsg };
          }

          /**
           * ts\n// before calling subTool.execute ...\nconst validatedArgs = subTool.parameters.parse(args);\nconst result = await subTool.execute(validatedArgs);\n
           */

          // @ts-expect-error - TODO: fix this
          const validatedArgs = subTool.parameters.parse(args);

          // @ts-expect-error - TODO: fix this
          const result = (await subTool.execute(validatedArgs)) as z.infer<
            typeof ResultSchema
          >;

          if (!result.success) {
            const errorMsg = `[combinedTools] Error on step ${i + 1} (${toolName}): ${result.error ?? "Unknown error"}`;
            console.error(errorMsg);
            return {
              success: false,
              error: `Step ${i + 1} (${toolName}) failed: ${result.error ?? "Unknown error"}`,
              content: result.content,
            };
          }

          // Store summary and potentially update last state
          const summary =
            result.content?.summary ?? `${toolName} executed successfully.`;
          results.push({ summary });
          lastStateJson =
            result.content?.updatedEditorStateJson ?? lastStateJson;

          console.log(
            `[combinedTools] Step ${i + 1} (${toolName}) succeeded: ${summary}`,
          );
        } // End loop

        // If all calls succeeded
        const combinedSummary = results
          .map((r, idx) => `Step ${idx + 1}: ${r.summary}`)
          .join("\n");

        // Capture final state if not captured by the last step
        if (lastStateJson === undefined && calls.length > 0) {
          editor.read(() => {
            // Use 'editor' via closure
            lastStateJson = JSON.stringify(editor.getEditorState().toJSON());
          });
        }

        console.log(
          `✅ [combinedTools] All ${calls.length} steps executed successfully.`,
        );
        return {
          success: true,
          content: {
            summary: `Combined execution successful:\n${combinedSummary}`,
            updatedEditorStateJson: lastStateJson,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `❌ [combinedTools] Unexpected error during execution:`,
          errorMsg,
        );
        return {
          success: false,
          error: `Combined execution failed: ${errorMsg}`,
        };
      }
    },
  });
  // -------------------------------------------------------------

  /* --------------------------------------------------------------
   * Final Combine & Return
   * --------------------------------------------------------------*/
  const tools = {
    ...individualTools,
    combinedTools, // Ensure combinedTools is included here
  } as unknown as RuntimeToolMap;

  return (
    <RuntimeToolsCtx.Provider value={tools}>
      {children}
    </RuntimeToolsCtx.Provider>
  );
}

export function useRuntimeTools() {
  const tools = useContext(RuntimeToolsCtx);
  if (!tools) {
    throw new Error("RuntimeToolsProvider not found");
  }
  return tools;
}
