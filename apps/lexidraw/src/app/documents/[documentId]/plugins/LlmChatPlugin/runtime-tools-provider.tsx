import { createContext, PropsWithChildren, useContext } from "react";
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
  DeckStrategicMetadata,
  SlideStrategicMetadata,
  ThemeSettingsSchema,
} from "../../nodes/SlideNode/SlideNode";
import { useChatDispatch } from "./llm-chat-context";
import { useLexicalStyleUtils } from "../../utils/lexical-style-utils";
import { useLexicalImageInsertion } from "~/hooks/use-image-insertion";
import { useLexicalImageGeneration } from "~/hooks/use-image-generation";
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
const InsertionAnchorSchema = z
  .discriminatedUnion("type", [
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
  ])
  .describe(
    "Anchor for insertion tools. Key is the key of the target node's key. Text is the text content of the target node.",
  );
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

// Schema for a single slide outline, used by the saveStoryboardOutput tool
const SlideOutlineSchema = z.object({
  slideNumber: z
    .number()
    .int()
    .positive()
    .describe("Sequential slide number, starting from 1."),
  title: z.string().describe("Concise and engaging title for the slide."),
  keyMessage: z
    .string()
    .describe("Bullet points summarizing the core message, can use Markdown."),
  visualIdea: z
    .string()
    .describe("Brief textual description of a potential visual or chart."),
  speakerNotes: z.string().describe("Brief notes for the presenter."),
});

// Schema for the arguments of the saveSlideContentAndNotes tool
const SlideContentAndNotesSchema = z.object({
  pageId: z
    .string()
    .describe("The ID of the slide page this content belongs to."),
  bodyContent: z
    .string()
    .describe("The main text content for the slide body, can be Markdown."),
  refinedSpeakerNotes: z
    .string()
    .describe("The revised and improved speaker notes for the slide."),
});

type ExecuteResult = Promise<z.infer<typeof ResultSchema>>;

// Define the result structure for the core node insertion logic
type NodeInsertionResult = {
  primaryNodeKey: string | null; // This will populate content.newNodeKey
  summaryContext?: string;
  additionalContent?: Record<string, string | undefined>; // For other keys like listNodeKey, firstItemKey
};

// Define a type for the core logic of each insertion tool
type NodeInserter<O extends Record<string, unknown>> = (
  resolution: Exclude<InsertionPointResolution, { status: "error" }>, // The resolved success location
  options: O, // The specific arguments for the tool
  currentEditor: LexicalEditor, // Pass the current editor instance
) => NodeInsertionResult;

// The mutator function receives the current data and must return the new data.
type SlideDeckMutator<O extends Record<string, unknown>> = (
  currentData: SlideDeckData,
  options: O,
) => {
  newData: SlideDeckData;
  summary: string;
  newNodeKey?: string; // For things like adding a new box or slide
};

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

  async function updateSlideDeckExecutor<
    O extends Record<string, unknown>, // Represents specific options for the mutator
    FullOptions extends O & { deckNodeKey: string; editorKey?: string }, // All options passed to execute
  >(
    toolName: string,
    baseEditor: LexicalEditor, // The base editor instance from useLexicalComposerContext
    options: FullOptions,
    mutator: SlideDeckMutator<O>,
    getEditorInstance: (editorKey?: string) => LexicalEditor, // Function to get target editor
  ): ExecuteResult {
    const { deckNodeKey, editorKey, ...specificMutatorOptions } = options;

    try {
      let result: { summary: string; newNodeKey?: string } | null = null;

      // SlideDeckNode modifications are typically on the main editor instance,
      // but we use getEditorInstance if editorKey was provided.
      const targetEditor = getEditorInstance(editorKey);

      targetEditor.update(() => {
        const deckNode = $getNodeByKey<SlideNode>(deckNodeKey);
        if (!SlideNode.$isSlideDeckNode(deckNode)) {
          throw new Error(
            `Node with key ${deckNodeKey} is not a valid SlideDeckNode.`,
          );
        }

        const currentData = deckNode.getData();
        const mutatorResult = mutator(currentData, specificMutatorOptions as O);

        deckNode.setData(mutatorResult.newData);
        result = {
          summary: mutatorResult.summary,
          newNodeKey: mutatorResult.newNodeKey,
        };
      });

      if (result === null) {
        // Explicitly check for null
        throw new Error(
          `[${toolName}] Update failed to produce a result for deck ${deckNodeKey}.`,
        );
      }

      // Assert the type of result after the null check
      const assertedResult = result as { summary: string; newNodeKey?: string };

      // Use baseEditor for getting the overall state
      const latestState = baseEditor.getEditorState();
      const stateJson = JSON.stringify(latestState.toJSON());

      console.log(`✅ [${toolName}] Success: ${assertedResult.summary}`);
      return {
        success: true,
        content: {
          summary: assertedResult.summary,
          updatedEditorStateJson: stateJson,
          newNodeKey: assertedResult.newNodeKey,
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `❌ [${toolName}] Error for deck ${deckNodeKey}:`,
        errorMsg,
      );
      // Use baseEditor for getting the overall state on error.
      const stateJsonOnError = JSON.stringify(
        baseEditor.getEditorState().toJSON(),
      );
      return {
        success: false,
        error: errorMsg,
        content: {
          summary: `Failed to execute ${toolName} on deck ${deckNodeKey}`,
          updatedEditorStateJson: stateJsonOnError,
        },
      };
    }
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

  /** The generic executor function. */
  async function insertionExecutor<O extends Record<string, unknown>>(
    toolName: string,
    baseEditor: LexicalEditor, // The base editor instance from useLexicalComposerContext
    options: O & {
      relation: InsertionRelation;
      anchor?: InsertionAnchor;
      editorKey?: string;
    },
    inserter: NodeInserter<O>,
    getEditorInstance: (editorKey?: string) => LexicalEditor, // Function to get target editor
    resolveInsertionPt: (
      currentEditor: LexicalEditor,
      relation: InsertionRelation,
      anchor?: InsertionAnchor,
    ) => Promise<InsertionPointResolution>, // Function to resolve insertion point
  ): ExecuteResult {
    const { relation, anchor, editorKey, ...specificOptions } = options;

    try {
      console.log(`[${toolName}] Starting`, options);

      const targetEditor = getEditorInstance(editorKey);

      const resolution = await resolveInsertionPt(
        targetEditor,
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
      targetEditor.update(() => {
        insertionOutcome = inserter(
          successResolution,
          specificOptions as unknown as O,
          targetEditor,
        );
      });

      // Use baseEditor for getting the overall state, as targetEditor might be a nested one.
      const latestState = baseEditor.getEditorState();
      const stateJson = JSON.stringify(latestState.toJSON());

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
      const stateJson = JSON.stringify(baseEditor.getEditorState().toJSON());
      return {
        success: false,
        error: errorMsg,
        content: {
          summary: `Failed to insert ${toolName}`,
          updatedEditorStateJson: stateJson,
        },
      };
    }
  }

  // Helper function to perform the actual node insertion based on resolution
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertTextNode",
        editor,
        options,
        (resolution, specificOptions, currentTargetEditor) => {
          const { text } = specificOptions as { text: string };
          const newTextNode = $createTextNode(text);
          let nodeToInsert: LexicalNode = newTextNode;
          let summaryCtx = "text content";
          let finalNewNodeKey = newTextNode.getKey();

          if (resolution.type === "appendRoot") {
            const paragraph = $createParagraphNode();
            paragraph.append(newTextNode);
            nodeToInsert = paragraph;
            finalNewNodeKey = paragraph.getKey();
            summaryCtx = "paragraph containing text";
          } else {
            // Relative insertion ('before' or 'after')
            // Accessing targetNode needs to be within an update/read cycle if using $getNodeByKey from top-level lexical scope.
            // However, resolution.targetKey is resolved outside, so we get the node here.
            const targetNode = currentTargetEditor
              .getEditorState()
              .read(() => $getNodeByKey(resolution.targetKey));

            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found within editor update for insertTextNode.`,
              );
            }

            if (!$isTextNode(targetNode)) {
              // If target is not a text node, wrap new text in a paragraph
              const paragraph = $createParagraphNode();
              paragraph.append(newTextNode);
              nodeToInsert = paragraph;
              finalNewNodeKey = paragraph.getKey();
              summaryCtx = "paragraph containing text";
            }
            // If target IS a TextNode, nodeToInsert remains newTextNode, and finalNewNodeKey is already newTextNode.getKey()
          }

          $insertNodeAtResolvedPoint(resolution, nodeToInsert);

          return {
            primaryNodeKey: finalNewNodeKey,
            summaryContext: summaryCtx,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertHeadingNode",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { text, tag } = specificOptions as {
            text: string;
            tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
          };
          const newHeadingNode = $createHeadingNode(tag).append(
            $createTextNode(text),
          );

          $insertNodeAtResolvedPoint(resolution, newHeadingNode);

          return {
            primaryNodeKey: newHeadingNode.getKey(),
            summaryContext: `${tag} heading`,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertListNode",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { listType, text } = specificOptions as {
            listType: ListType;
            text: string;
          };

          const listItem = $createListItemNode(
            listType === "check" ? false : undefined,
          );
          listItem.append($createTextNode(text));

          const newList = $createListNode(listType);
          newList.append(listItem);

          $insertNodeAtResolvedPoint(resolution, newList);

          return {
            primaryNodeKey: newList.getKey(),
            summaryContext: `${listType} list`,
            additionalContent: {
              listNodeKey: newList.getKey(),
              firstItemKey: listItem.getKey(),
            },
          };
        },
        getTargetEditorInstance,
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

        const targetEditor = getTargetEditorInstance(editorKey);
        let validatedTargetKey: string | null = null;
        let checkValue: boolean | undefined;
        let validationError: string | null = null;

        // --- Resolve anchor and perform validation INSIDE editor.read ---
        targetEditor.read(() => {
          let resolvedTargetNode: LexicalNode | null = null;
          if (anchor.type === "key") {
            resolvedTargetNode = $getNodeByKey(anchor.key);
          } else {
            resolvedTargetNode = findFirstNodeByText(targetEditor, anchor.text);
            // Attempt to find parent list/item if initial find is not suitable
            if (
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
          }

          if (!resolvedTargetNode) {
            const anchorDesc =
              anchor.type === "key"
                ? `key "${anchor.key}"`
                : `text "${anchor.text}"`;
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
              resolvedTargetNode.getListType() === "check" ? false : undefined;
          } else {
            // 'before' or 'after'
            if (!$isListItemNode(resolvedTargetNode)) {
              validationError = `Anchor must resolve to a ListItemNode for relation '${relation}', but found ${targetType}.`;
              return;
            }
            checkValue =
              typeof resolvedTargetNode.getChecked() === "boolean"
                ? false
                : undefined;
          }
        });

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
          newListItem.append($createTextNode(text));
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
        const stateJson = JSON.stringify(latestState.toJSON());
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
        let stateJsonOnError = "{}";
        try {
          stateJsonOnError = JSON.stringify(editor.getEditorState().toJSON());
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertCodeBlock",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { language, initialText } = specificOptions as {
            language?: string;
            initialText?: string;
          };

          const newCodeNode = $createCodeNode();
          if (language) {
            // Safely check for and call setLanguage if it exists
            if (
              "setLanguage" in newCodeNode &&
              typeof newCodeNode.setLanguage === "function"
            ) {
              newCodeNode.setLanguage(language);
            } else {
              console.warn(
                `[insertCodeBlock:inserter] Could not set language '${language}' on CodeNode. Method setLanguage might not exist or is not callable.`,
              );
            }
          }
          if (initialText) {
            newCodeNode.append($createTextNode(initialText));
          }

          $insertNodeAtResolvedPoint(resolution, newCodeNode);

          return {
            primaryNodeKey: newCodeNode.getKey(),
            summaryContext: `Code Block${language ? ` (${language})` : ""}`,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertCodeHighlightNode",
        editor,
        options,
        (resolution, specificOptions, currentTargetEditor) => {
          const { text } = specificOptions as { text: string };
          const newHighlightNode = $createCodeHighlightNode(text);
          let nodeToInsert: LexicalNode = newHighlightNode;
          let summaryCtx = "CodeHighlightNode";
          let finalNewNodeKey = newHighlightNode.getKey();

          if (resolution.type === "appendRoot") {
            const paragraph = $createParagraphNode();
            paragraph.append(newHighlightNode);
            nodeToInsert = paragraph;
            finalNewNodeKey = paragraph.getKey();
            summaryCtx = "paragraph containing CodeHighlightNode";
          } else {
            // Relative insertion
            const targetNode = currentTargetEditor
              .getEditorState()
              .read(() => $getNodeByKey(resolution.targetKey));
            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found for insertCodeHighlightNode.`,
              );
            }

            // If target is not suitable for direct inline insertion, wrap in a paragraph.
            if (
              !($isTextNode(targetNode) || $isCodeHighlightNode(targetNode))
            ) {
              const paragraph = $createParagraphNode();
              paragraph.append(newHighlightNode);
              nodeToInsert = paragraph;
              finalNewNodeKey = paragraph.getKey();
              summaryCtx = "paragraph containing CodeHighlightNode";
            }
            // If target IS a TextNode or CodeHighlightNode, nodeToInsert remains newHighlightNode
          }

          $insertNodeAtResolvedPoint(resolution, nodeToInsert);

          return {
            primaryNodeKey: finalNewNodeKey,
            summaryContext: summaryCtx,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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

        // After status check, resolution is of success type
        const successResolution = resolution as Exclude<
          InsertionPointResolution,
          { status: "error" }
        >;

        targetEditor.update(
          () => {
            const placeholderNode = $createParagraphNode();
            // Insert the placeholder first using our helper
            $insertNodeAtResolvedPoint(successResolution, placeholderNode);

            // Now, convert markdown targeting the placeholder.
            // $convertFromMarkdownString may replace placeholderNode or fill it.
            console.log(
              `[insertMarkdown] Calling $convertFromMarkdownString, targeting placeholder node: ${placeholderNode.getKey()}`,
            );
            $convertFromMarkdownString(
              markdownText,
              TRANSFORMERS,
              placeholderNode, // Target the placeholder
            );

            // Check the node by key again as it might have been replaced or removed
            // and then re-added by $convertFromMarkdownString if markdown was empty.
            const finalNode = $getNodeByKey(placeholderNode.getKey());
            if (
              finalNode &&
              $isElementNode(finalNode) &&
              finalNode.isAttached() &&
              finalNode.isEmpty()
            ) {
              console.log(
                `[insertMarkdown] Placeholder node ${finalNode.getKey()} is empty after conversion, removing it.`,
              );
              finalNode.remove();
            }
          },
          { tag: "llm-insert-markdown" },
        );

        const latestState = editor.getEditorState();
        const stateJson = JSON.stringify(latestState.toJSON());

        const targetKeyForSummary =
          successResolution.type === "appendRoot"
            ? "root"
            : successResolution.targetKey;
        const summary =
          successResolution.type === "appendRoot"
            ? `Appended content from Markdown.`
            : `Inserted content from Markdown ${successResolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertMarkdown] Success: ${summary}`);

        return {
          success: true,
          content: { summary, updatedEditorStateJson: stateJson },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertMarkdown] Error:`, errorMsg);
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertTable",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { rows, columns } = specificOptions as {
            rows: number;
            columns: number;
          };

          const newTable = $createTableNode();

          for (let i = 0; i < rows; i++) {
            const tableRow = $createTableRowNode();
            for (let j = 0; j < columns; j++) {
              const tableCell = $createTableCellNode();
              const paragraph = $createParagraphNode();
              paragraph.append($createTextNode("")); // Ensure cell is editable
              tableCell.append(paragraph);
              tableRow.append(tableCell);
            }
            newTable.append(tableRow);
          }

          $insertNodeAtResolvedPoint(resolution, newTable);

          return {
            primaryNodeKey: newTable.getKey(),
            summaryContext: `${rows}x${columns} table`,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertHashtag",
        editor,
        options,
        (resolution, specificOptions, currentTargetEditor) => {
          const { text } = specificOptions as { text: string };
          const newHashtagNode = $createHashtagNode(text);
          let nodeToInsert: LexicalNode = newHashtagNode;
          let summaryCtx = `hashtag '#${text}'`;
          let finalNewNodeKey = newHashtagNode.getKey();

          if (resolution.type === "appendRoot") {
            const paragraph = $createParagraphNode();
            paragraph.append(newHashtagNode);
            nodeToInsert = paragraph;
            finalNewNodeKey = paragraph.getKey();
            summaryCtx = `paragraph containing hashtag '#${text}'`;
          } else {
            const targetNode = currentTargetEditor
              .getEditorState()
              .read(() => $getNodeByKey(resolution.targetKey));
            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found for insertHashtag.`,
              );
            }
            // If target is not suitable for direct inline insertion (e.g., not a TextNode or another HashtagNode),
            // wrap the HashtagNode in a paragraph.
            if (!($isTextNode(targetNode) || $isHashtagNode(targetNode))) {
              const paragraph = $createParagraphNode();
              paragraph.append(newHashtagNode);
              nodeToInsert = paragraph;
              finalNewNodeKey = paragraph.getKey();
              summaryCtx = `paragraph containing hashtag '#${text}'`;
            }
            // If target IS a TextNode/HashtagNode, nodeToInsert remains newHashtagNode
          }

          $insertNodeAtResolvedPoint(resolution, nodeToInsert);

          return {
            primaryNodeKey: finalNewNodeKey,
            summaryContext: summaryCtx,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertLinkNode",
        editor,
        options,
        (resolution, specificOptions, currentTargetEditor) => {
          const { url, linkText, attributes } = specificOptions as {
            url: string;
            linkText?: string;
            attributes?: { rel?: string; target?: string; title?: string };
          };

          const actualLinkText = linkText || url;
          const newLinkNode = $createLinkNode(url, attributes);
          newLinkNode.append($createTextNode(actualLinkText));

          let nodeToInsert: LexicalNode = newLinkNode;
          let summaryCtx = `link to '${url}'`;
          let finalNewNodeKey = newLinkNode.getKey();

          if (resolution.type === "appendRoot") {
            const paragraph = $createParagraphNode();
            paragraph.append(newLinkNode);
            nodeToInsert = paragraph;
            finalNewNodeKey = paragraph.getKey();
            summaryCtx = `paragraph containing a link to '${url}'`;
          } else {
            const targetNode = currentTargetEditor
              .getEditorState()
              .read(() => $getNodeByKey(resolution.targetKey));
            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found for insertLinkNode.`,
              );
            }
            if (
              !(
                $isTextNode(targetNode) ||
                ($isElementNode(targetNode) && targetNode.isInline())
              )
            ) {
              const paragraph = $createParagraphNode();
              paragraph.append(newLinkNode);
              nodeToInsert = paragraph;
              finalNewNodeKey = paragraph.getKey();
              summaryCtx = `paragraph containing a link to '${url}'`;
            }
          }

          $insertNodeAtResolvedPoint(resolution, nodeToInsert);

          return {
            primaryNodeKey: finalNewNodeKey,
            summaryContext: summaryCtx,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertEquationNode",
        editor,
        options,
        (resolution, specificOptions, currentTargetEditor) => {
          const { equation, inline } = specificOptions as {
            equation: string;
            inline?: boolean;
          };
          const newEquationNode = EquationNode.$createEquationNode(
            equation,
            inline ?? false,
          );

          let nodeToInsert: LexicalNode = newEquationNode;
          let finalNewNodeKey = newEquationNode.getKey();
          let summaryCtx = `${inline ? "inline" : "block"} equation`;

          if (resolution.type === "appendRoot") {
            if (inline) {
              const paragraph = $createParagraphNode();
              paragraph.append(newEquationNode);
              nodeToInsert = paragraph;
              finalNewNodeKey = paragraph.getKey();
              summaryCtx = `paragraph containing an inline equation`;
            }
            // If block, nodeToInsert remains newEquationNode
          } else {
            // Relative insertion
            const targetNode = currentTargetEditor
              .getEditorState()
              .read(() => $getNodeByKey(resolution.targetKey));
            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found for insertEquationNode.`,
              );
            }

            if (inline) {
              // For inline equations, wrap in a paragraph if the target isn't suitable for inline insertion.
              if (
                !(
                  $isTextNode(targetNode) ||
                  ($isElementNode(targetNode) && targetNode.isInline())
                )
              ) {
                const paragraph = $createParagraphNode();
                paragraph.append(newEquationNode);
                nodeToInsert = paragraph;
                finalNewNodeKey = paragraph.getKey();
                summaryCtx = `paragraph containing an inline equation`;
              }
            }
          }

          $insertNodeAtResolvedPoint(resolution, nodeToInsert);

          return {
            primaryNodeKey: finalNewNodeKey,
            summaryContext: summaryCtx,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertFigmaNode",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { documentID, format } = specificOptions as {
            documentID: string;
            format?: "left" | "center" | "right" | "justify";
          };
          const newFigmaNode = FigmaNode.$createFigmaNode(documentID);
          if (format) {
            newFigmaNode.setFormat(format);
          }

          $insertNodeAtResolvedPoint(resolution, newFigmaNode);

          return {
            primaryNodeKey: newFigmaNode.getKey(),
            summaryContext: `Figma embed (ID: ${documentID})`,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertCollapsibleSection",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { titleText, initialContentMarkdown, initiallyOpen } =
            specificOptions as {
              titleText: string;
              initialContentMarkdown?: string;
              initiallyOpen?: boolean;
            };

          const containerNode =
            CollapsibleContainerNode.$createCollapsibleContainerNode(
              initiallyOpen ?? false,
            );
          const titleNode = CollapsibleTitleNode.$createCollapsibleTitleNode();
          const titleParagraph = $createParagraphNode().append(
            $createTextNode(titleText),
          );
          titleNode.append(titleParagraph);

          const contentNode =
            CollapsibleContentNode.$createCollapsibleContentNode();
          if (initialContentMarkdown && initialContentMarkdown.trim() !== "") {
            $convertFromMarkdownString(
              initialContentMarkdown,
              TRANSFORMERS,
              contentNode,
            );
          }
          if (contentNode.isEmpty()) {
            // Ensure content is not empty
            contentNode.append($createParagraphNode());
          }

          containerNode.append(titleNode, contentNode);

          $insertNodeAtResolvedPoint(resolution, containerNode);

          return {
            primaryNodeKey: containerNode.getKey(),
            summaryContext: `collapsible section titled '${titleText}'`,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
        mermaid: mermaidLines.join("\n"), // Add mermaid string property
      })),
    execute: async (options): ExecuteResult => {
      const {
        mermaid,
        mermaidConfig,
        excalidrawConfig,
        width,
        height,
        relation,
        anchor,
        editorKey,
      } = options;

      // Perform asynchronous parsing before calling insertionExecutor
      let parseResult: MermaidToExcalidrawResult;
      try {
        const mermaidCfg: MermaidConfig = { ...(mermaidConfig ?? {}) };
        parseResult = await parseMermaidToExcalidraw(mermaid, mermaidCfg);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `❌ [insertExcalidrawDiagram] Mermaid parsing failed: ${msg}`,
        );
        return { success: false, error: `Mermaid parsing failed: ${msg}` };
      }

      const excaliCfg: ExcalidrawConfig = {
        ...DEFAULT_EXCALIDRAW_CFG,
        ...(excalidrawConfig ?? {}),
      };
      const elements = convertToExcalidrawElements(parseResult.elements, {
        regenerateIds: true,
        ...excaliCfg,
      });

      const excaliData = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "mermaid‑to‑excalidraw@latest",
        elements,
        files: parseResult.files ?? {},
      });

      // Define the options that the synchronous inserter will receive
      type ExcalidrawInserterPayload = {
        width?: number | "inherit";
        height?: number | "inherit";
        excaliData: string;
        elementsLength: number;
      };

      const inserterOptions: ExcalidrawInserterPayload & {
        relation: InsertionRelation;
        anchor?: InsertionAnchor;
        editorKey?: string;
      } = {
        width,
        height,
        excaliData,
        elementsLength: elements.length,
        relation,
        anchor,
        editorKey,
      };

      return insertionExecutor<ExcalidrawInserterPayload>( // Type of specificOptions for the inserter
        "insertExcalidrawDiagram",
        editor,
        inserterOptions, // Pass the processed options
        (resolution, specificOptions, _currentTargetEditor) => {
          // This inserter is now synchronous
          const {
            width: w,
            height: h,
            excaliData: ed,
            elementsLength,
          } = specificOptions;

          const node = new ExcalidrawNode(
            ed,
            false /** keep closed by default */,
            w ?? DEFAULT_CANVAS_WIDTH,
            h ?? DEFAULT_CANVAS_HEIGHT,
          );

          $insertNodeAtResolvedPoint(resolution, node);

          return {
            primaryNodeKey: node.getKey(),
            summaryContext: `Excalidraw diagram from Mermaid (${elementsLength} elements)`,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      // 'schema' is added by the transform. Define options for the inserter.
      type InserterOptions = Omit<
        typeof options,
        "relation" | "anchor" | "editorKey"
      > & { schema: string };

      return insertionExecutor(
        "insertMermaidDiagram",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { schema, width, height } = specificOptions as InserterOptions;

          const mermaidNode = MermaidNode.$createMermaidNode(
            schema,
            width,
            height,
          );

          $insertNodeAtResolvedPoint(resolution, mermaidNode);

          return {
            primaryNodeKey: mermaidNode.getKey(),
            summaryContext: `Mermaid diagram (${width}×${height})`,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertLayout",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { templateColumns } = specificOptions as {
            templateColumns: string;
          };

          const containerNode =
            LayoutContainerNode.$createLayoutContainerNode(templateColumns);

          const columnDefinitions = templateColumns
            .split(" ")
            .filter((def) => def.trim() !== "");
          const numberOfColumns = columnDefinitions.length;

          if (numberOfColumns === 0) {
            const emptyParagraph = $createParagraphNode();
            containerNode.append(emptyParagraph);
          } else {
            for (let i = 0; i < numberOfColumns; i++) {
              const itemNode = LayoutItemNode.$createLayoutItemNode();
              const paragraphNode = $createParagraphNode();
              itemNode.append(paragraphNode);
              containerNode.append(itemNode);
            }
          }

          $insertNodeAtResolvedPoint(resolution, containerNode);

          return {
            primaryNodeKey: containerNode.getKey(),
            summaryContext: `layout with columns: ${templateColumns}`,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertPageBreakNode",
        editor,
        options,
        (resolution, _specificOptions, _currentTargetEditor) => {
          const newPageBreak = PageBreakNode.$createPageBreakNode();
          $insertNodeAtResolvedPoint(resolution, newPageBreak);
          return {
            primaryNodeKey: newPageBreak.getKey(),
            summaryContext: "Page Break",
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertPollNode",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { question, optionTexts } = specificOptions as {
            question: string;
            optionTexts: string[];
          };

          const pollOptions = optionTexts.map((text) =>
            PollNode.createPollOption(text),
          );
          const newPollNode = PollNode.$createPollNode(question, pollOptions);

          $insertNodeAtResolvedPoint(resolution, newPollNode);

          return {
            primaryNodeKey: newPollNode.getKey(),
            summaryContext: `poll: "${question}"`,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertTweetNode",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { tweetID, format } = specificOptions as {
            tweetID: string;
            format?: "left" | "center" | "right" | "justify";
          };

          const newTweetNode = TweetNode.$createTweetNode(tweetID);
          if (format) {
            newTweetNode.setFormat(format);
          }

          $insertNodeAtResolvedPoint(resolution, newTweetNode);

          return {
            primaryNodeKey: newTweetNode.getKey(),
            summaryContext: `Tweet embed (ID: ${tweetID})`,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertYouTubeNode",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { videoID, format } = specificOptions as {
            videoID: string;
            format?: "left" | "center" | "right" | "justify";
          };

          const newYouTubeNode = YouTubeNode.$createYouTubeNode(videoID);
          if (format) {
            newYouTubeNode.setFormat(format);
          }

          $insertNodeAtResolvedPoint(resolution, newYouTubeNode);

          return {
            primaryNodeKey: newYouTubeNode.getKey(),
            summaryContext: `YouTube video embed (ID: ${videoID})`,
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
    execute: async (options): ExecuteResult => {
      return insertionExecutor(
        "insertSlideDeckNode",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { initialDataJSON } = specificOptions as {
            initialDataJSON?: string;
          };

          let slideData: SlideDeckData;
          if (initialDataJSON) {
            try {
              slideData = JSON.parse(initialDataJSON) as SlideDeckData;
            } catch (e) {
              console.warn(
                "[insertSlideDeckNode:inserter] Failed to parse initialDataJSON, using default data.",
                e,
              );
              slideData = DEFAULT_SLIDE_DECK_DATA;
            }
          } else {
            slideData = DEFAULT_SLIDE_DECK_DATA;
          }

          const newSlideDeckNode = SlideNode.$createSlideNode(slideData);
          $insertNodeAtResolvedPoint(resolution, newSlideDeckNode);

          return {
            primaryNodeKey: newSlideDeckNode.getKey(),
            summaryContext: "Slide Deck",
          };
        },
        getTargetEditorInstance,
        resolveInsertionPoint,
      );
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
   * Set Deck Metadata Tool
   * --------------------------------------------------------------*/
  const setDeckMetadata = tool({
    description:
      "Sets or updates the strategic metadata for an entire SlideDeckNode.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      deckMetadata: z
        .custom<DeckStrategicMetadata>()
        .describe("The strategic metadata object to set for the deck."),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options): ExecuteResult => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "setDeckMetadata",
        editor,
        options,
        (currentData, opts) => {
          const { deckMetadata } = opts;
          const summary = `Set deck-level strategic metadata for deck ${options.deckNodeKey}.`;
          return {
            newData: {
              ...currentData,
              deckMetadata: {
                // Merge with existing or set new
                ...(currentData.deckMetadata || {}),
                ...deckMetadata,
              },
            },
            summary: summary,
          };
        },
        getTargetEditorInstance,
      );
    },
  });

  /* --------------------------------------------------------------
   * Set Slide Metadata Tool
   * --------------------------------------------------------------*/
  const setSlideMetadata = tool({
    description:
      "Sets or updates the strategic metadata for a specific slide within a SlideDeckNode.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      slideId: z
        .string()
        .describe("The ID of the slide page to update the metadata for."),
      slideMetadata: z
        .custom<SlideStrategicMetadata>()
        .describe("The strategic metadata object to set for the slide."),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options): ExecuteResult => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "setSlideMetadata",
        editor,
        options,
        (currentData, opts) => {
          const { slideId, slideMetadata } = opts;
          const targetSlideIndex = currentData.slides.findIndex(
            (s) => s.id === slideId,
          );

          if (targetSlideIndex === -1) {
            throw new Error(
              `Slide with ID ${slideId} not found in deck ${options.deckNodeKey}.`,
            );
          }

          const updatedSlides = currentData.slides.map((slide, index) => {
            if (index === targetSlideIndex) {
              return {
                ...slide,
                slideMetadata: {
                  // Merge with existing or set new
                  ...(slide.slideMetadata || {}),
                  ...slideMetadata,
                },
              };
            }
            return slide;
          });

          const summary = `Set strategic metadata for slide ${slideId} in deck ${options.deckNodeKey}.`;
          return {
            newData: {
              ...currentData,
              slides: updatedSlides,
            },
            summary: summary,
          };
        },
        getTargetEditorInstance,
      );
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
      slideMetadata: z
        .custom<SlideStrategicMetadata>()
        .optional()
        .describe("Optional strategic metadata for the new slide."),
      editorKey: EditorKeySchema.optional(), // Added editorKey to parameters
    }),
    execute: async (options): ExecuteResult => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "addSlidePage",
        editor,
        options,
        (currentData, opts) => {
          const {
            newSlideId,
            insertionIndex,
            focusNewSlide,
            backgroundColor,
            slideMetadata,
          } = opts;
          const newId = newSlideId || `slide-${Date.now()}`;
          const newPage: SlideData = {
            id: newId,
            elements: [],
            backgroundColor,
            slideMetadata, // Store the metadata
          };

          const newSlides = [...currentData.slides];
          let actualInsertionIndex = insertionIndex;

          if (
            actualInsertionIndex === undefined ||
            actualInsertionIndex < 0 ||
            actualInsertionIndex > newSlides.length
          ) {
            actualInsertionIndex = newSlides.length; // Append to end
          }
          newSlides.splice(actualInsertionIndex, 0, newPage);

          const summary =
            `Added new slide page (ID: ${newId}) to deck ${options.deckNodeKey} at index ${actualInsertionIndex}.` +
            (focusNewSlide ? " Focused new slide." : "");

          return {
            newData: {
              ...currentData,
              slides: newSlides,
              currentSlideId: focusNewSlide
                ? newId
                : currentData.currentSlideId,
            },
            summary: summary,
            newNodeKey: newId, // The key of the new slide page
          };
        },
        getTargetEditorInstance,
      );
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
      editorKey: EditorKeySchema.optional(), // Ensure editorKey is part of params
    }),
    execute: async (options): ExecuteResult => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "removeSlidePage",
        editor,
        options,
        (currentData, opts) => {
          const { slideIdToRemove } = opts;

          if (currentData.slides.length <= 1) {
            throw new Error("Cannot remove the last slide from a deck.");
          }

          const slideToRemoveIndex = currentData.slides.findIndex(
            (s) => s.id === slideIdToRemove,
          );

          if (slideToRemoveIndex === -1) {
            // Access options.deckNodeKey from the outer scope for the error message if needed,
            // or ensure deckNodeKey is passed into opts if mutator needs it directly.
            // For this error, using the closure `options.deckNodeKey` is fine.
            throw new Error(
              `Slide with ID ${slideIdToRemove} not found in deck ${options.deckNodeKey}.`,
            );
          }

          const newSlides = currentData.slides.filter(
            (s) => s.id !== slideIdToRemove,
          );

          let newCurrentSlideId = currentData.currentSlideId;
          if (currentData.currentSlideId === slideIdToRemove) {
            if (newSlides.length > 0) {
              const newFocusIndex = Math.max(0, slideToRemoveIndex - 1);
              newCurrentSlideId = newSlides[newFocusIndex]?.id ?? null;
              if (!newCurrentSlideId && newSlides[0]?.id) {
                newCurrentSlideId = newSlides[0].id;
              }
            } else {
              newCurrentSlideId = null;
            }
          }

          let summary = `Removed slide page (ID: ${slideIdToRemove}) from deck ${options.deckNodeKey}.`;
          if (
            currentData.currentSlideId === slideIdToRemove &&
            newCurrentSlideId
          ) {
            summary += ` New current slide is ${newCurrentSlideId}.`;
          } else if (
            currentData.currentSlideId === slideIdToRemove &&
            !newCurrentSlideId
          ) {
            // This case should be rare if the deck can't be emptied by this operation.
            summary += ` Current slide focus cleared (deck might be empty or in an unexpected state).`;
          }

          return {
            newData: {
              ...currentData,
              slides: newSlides,
              currentSlideId: newCurrentSlideId,
            },
            summary: summary,
            // newNodeKey is typically not set for removal, but one could return slideIdToRemove if needed.
          };
        },
        getTargetEditorInstance,
      );
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
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options): ExecuteResult => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "reorderSlidePage",
        editor, // from RuntimeToolsProvider scope
        options,
        (currentData, opts) => {
          const { slideIdToMove, newIndex } = opts;
          const slideToMove = currentData.slides.find(
            (s) => s.id === slideIdToMove,
          );

          if (!slideToMove) {
            throw new Error(
              `Slide with ID ${slideIdToMove} not found in deck ${options.deckNodeKey}.`,
            );
          }

          const tempSlides = currentData.slides.filter(
            (s) => s.id !== slideIdToMove,
          );

          const actualNewIndex = Math.max(
            0,
            Math.min(newIndex, tempSlides.length),
          );

          tempSlides.splice(actualNewIndex, 0, slideToMove);
          const summary = `Reordered slide page (ID: ${slideIdToMove}) in deck ${options.deckNodeKey} to new index ${actualNewIndex}.`;

          return {
            newData: {
              ...currentData,
              slides: tempSlides,
            },
            summary: summary,
            // newNodeKey could be slideIdToMove if useful for the caller
          };
        },
        getTargetEditorInstance,
      );
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
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options): ExecuteResult => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "setSlidePageBackground",
        editor, // from RuntimeToolsProvider scope
        options,
        (currentData, opts) => {
          const { slideTarget, backgroundColor } = opts;
          let targetSlideIndex = -1;

          if (slideTarget.type === "id") {
            targetSlideIndex = currentData.slides.findIndex(
              (s) => s.id === slideTarget.slideId,
            );
            if (targetSlideIndex === -1) {
              throw new Error(
                `Slide with ID ${slideTarget.slideId} not found in deck ${options.deckNodeKey}.`,
              );
            }
          } else {
            targetSlideIndex = slideTarget.slideIndex;
            if (
              targetSlideIndex < 0 ||
              targetSlideIndex >= currentData.slides.length
            ) {
              throw new Error(
                `Slide index ${targetSlideIndex} is out of bounds for deck ${options.deckNodeKey}. Number of slides: ${currentData.slides.length}`,
              );
            }
          }

          const targetSlide = currentData.slides[targetSlideIndex];
          if (!targetSlide) {
            throw new Error(
              `Target slide at index ${targetSlideIndex} could not be retrieved for deck ${options.deckNodeKey}.`,
            );
          }

          const updatedSlideData = {
            ...targetSlide,
            backgroundColor: backgroundColor,
          };

          const newSlides = [...currentData.slides];
          newSlides[targetSlideIndex] = updatedSlideData;
          const summary = `Set background color of slide ${slideTarget.type === "id" ? slideTarget.slideId : `index ${targetSlideIndex}`} in deck ${options.deckNodeKey} to ${backgroundColor}.`;

          return {
            newData: { ...currentData, slides: newSlides },
            summary: summary,
            // newNodeKey could be targetSlide.id if useful
          };
        },
        getTargetEditorInstance,
      );
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
        .describe(
          "Optional width of the box. Defaults to 300. The slide itself is 1280px wide.",
        ),
      height: z
        .number()
        .optional()
        .default(150)
        .describe(
          "Optional height of the box. Defaults to 150. The slide itself is 720px tall.",
        ),
      backgroundColor: z
        .string()
        .optional()
        .default("transparent")
        .describe(
          "Optional background color for the box (e.g., '#FF0000', 'blue'). Defaults to transparent.",
        ),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options): ExecuteResult => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "addBoxToSlidePage",
        editor,
        options,
        (currentData, opts) => {
          const {
            slideId,
            initialTextContent,
            boxId,
            x,
            y,
            width,
            height,
            backgroundColor,
          } = opts;

          const targetSlideIndex = currentData.slides.findIndex(
            (s) => s.id === slideId,
          );

          if (targetSlideIndex === -1) {
            throw new Error(
              `Slide with ID ${slideId} not found in deck ${options.deckNodeKey}.`,
            );
          }
          const targetSlide = currentData.slides[targetSlideIndex];
          if (!targetSlide) {
            // Should be caught by index check, but safeguard
            throw new Error(
              `Target slide ${slideId} could not be retrieved from deck ${options.deckNodeKey}.`,
            );
          }

          const getNextZIndexForSlideElements = (
            elements: SlideElementSpec[],
          ): number => {
            if (!elements || elements.length === 0) {
              return 0;
            }
            return Math.max(...elements.map((el) => el.zIndex), -1) + 1;
          };

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
                      format: "0", // Default format for text node
                      mode: "normal",
                      style: "",
                      direction: null, // Added direction
                      indent: 0, // Added indent
                    },
                  ],
                },
              ],
            },
          };

          const newBoxGeneratedId = boxId || `box-${Date.now()}`;
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
            zIndex: getNextZIndexForSlideElements(targetSlide.elements || []),
          };

          const updatedSlides = currentData.slides.map((slide, index) => {
            if (index === targetSlideIndex) {
              return {
                ...slide,
                elements: [...(slide.elements || []), newBoxElement],
              };
            }
            return slide;
          });

          const summary = `Added new box (ID: ${newBoxGeneratedId}) with content to slide ${slideId} in deck ${options.deckNodeKey}.`;

          return {
            newData: {
              ...currentData,
              slides: updatedSlides,
            },
            summary: summary,
            newNodeKey: newBoxGeneratedId,
          };
        },
        getTargetEditorInstance,
      );
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
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options): ExecuteResult => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "updateBoxPropertiesOnSlidePage",
        editor,
        options,
        (currentData, opts) => {
          const { slideId, boxId, properties } = opts;

          const targetSlideIndex = currentData.slides.findIndex(
            (s) => s.id === slideId,
          );

          if (targetSlideIndex === -1) {
            throw new Error(
              `Slide with ID ${slideId} not found in deck ${options.deckNodeKey}.`,
            );
          }

          let boxFoundAndUpdated = false;
          const updatedSlides = currentData.slides.map((slide, index) => {
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
              `Box with ID ${boxId} not found on slide ${slideId} in deck ${options.deckNodeKey}.`,
            );
          }

          const summary = `Updated properties of box (ID: ${boxId}) on slide ${slideId} in deck ${options.deckNodeKey}. Changed: ${Object.keys(properties).join(", ")}`;

          return {
            newData: {
              ...currentData,
              slides: updatedSlides,
            },
            summary: summary,
            newNodeKey: boxId, // The key of the updated box
          };
        },
        getTargetEditorInstance,
      );
    },
  });

  /* --------------------------------------------------------------
   * Add Image to Slide Page Tool
   * --------------------------------------------------------------*/
  const addImageToSlidePage = tool({
    description:
      "Adds a new image element to a specific slide page within an existing SlideDeckNode.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      slideId: z
        .string()
        .describe("The ID of the slide page to add the image to."),
      imageUrl: z.string().describe("The URL of the image."),
      imageId: z
        .string()
        .optional()
        .describe(
          "Optional ID for the new image. If not provided, a unique ID (e.g., 'image-<timestamp>') will be generated.",
        ),
      x: z
        .number()
        .optional()
        .default(50)
        .describe(
          "Optional X coordinate for the top-left corner. Defaults to 50.",
        ),
      y: z
        .number()
        .optional()
        .default(50)
        .describe(
          "Optional Y coordinate for the top-left corner. Defaults to 50.",
        ),
      width: z
        .number()
        .optional()
        .default(250)
        .describe("Optional width. Defaults to 250."),
      height: z
        .number()
        .optional()
        .default(150)
        .describe("Optional height. Defaults to 150."),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options): ExecuteResult => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "addImageToSlidePage",
        editor,
        options,
        (currentData, opts) => {
          const { slideId, imageUrl, imageId, x, y, width, height } = opts;

          const targetSlideIndex = currentData.slides.findIndex(
            (s) => s.id === slideId,
          );

          if (targetSlideIndex === -1) {
            throw new Error(
              `Slide with ID ${slideId} not found in deck ${options.deckNodeKey}.`,
            );
          }
          const targetSlide = currentData.slides[targetSlideIndex];
          if (!targetSlide) {
            throw new Error(
              `Target slide ${slideId} could not be retrieved from deck ${options.deckNodeKey}.`,
            );
          }

          const getNextZIndexForSlideElements = (
            elements: SlideElementSpec[],
          ): number => {
            if (!elements || elements.length === 0) return 0;
            return Math.max(...elements.map((el) => el.zIndex), -1) + 1;
          };

          const newImageGeneratedId = imageId || `image-${Date.now()}`;
          const newImageElement: SlideElementSpec = {
            kind: "image",
            id: newImageGeneratedId,
            x: x || 50,
            y: y || 50,
            width: width || 250,
            height: height || 150,
            url: imageUrl,
            version: 1,
            zIndex: getNextZIndexForSlideElements(targetSlide.elements || []),
          };

          const updatedSlides = currentData.slides.map((slide, index) => {
            if (index === targetSlideIndex) {
              return {
                ...slide,
                elements: [...(slide.elements || []), newImageElement],
              };
            }
            return slide;
          });

          const summary = `Added new image (ID: ${newImageGeneratedId}, URL: ${imageUrl.substring(0, 50)}...) to slide ${slideId} in deck ${options.deckNodeKey}.`;

          return {
            newData: {
              ...currentData,
              slides: updatedSlides,
            },
            summary: summary,
            newNodeKey: newImageGeneratedId,
          };
        },
        getTargetEditorInstance,
      );
    },
  });

  /* --------------------------------------------------------------
   * Add Chart to Slide Page Tool
   * --------------------------------------------------------------*/
  const addChartToSlidePage = tool({
    description:
      "Adds a new chart element to a specific slide page within an existing SlideDeckNode.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      slideId: z
        .string()
        .describe("The ID of the slide page to add the chart to."),
      chartType: z
        .enum(["bar", "line", "pie"])
        .default("bar")
        .describe("Type of chart (bar, line, pie). Defaults to bar."),
      chartDataJSON: z
        .string()
        .optional()
        .default("[]")
        .describe(
          'JSON string representing the chart data. Defaults to an empty array. Example: [{"month":"January","desktop":186,"mobile":80},{"month":"February","desktop":305,"mobile":200},{"month":"March","desktop":237,"mobile":120},{"month":"April","desktop":73,"mobile":190},{"month":"May","desktop":209,"mobile":130},{"month":"June","desktop":214,"mobile":140}]',
        ),
      chartConfigJSON: z
        .string()
        .optional()
        .default("{}")
        .describe(
          "JSON string representing the chart configuration for recharts. Defaults to an empty object. Example: {value: {label: 'Value', color: 'hsl(var(--chart-1))'}} Besides css variables for chart-1 to chart-5, you can also use hex colors.",
        ),
      chartId: z
        .string()
        .optional()
        .describe(
          "Optional ID for the new chart. If not provided, a unique ID (e.g., 'chart-<timestamp>') will be generated.",
        ),
      x: z
        .number()
        .optional()
        .default(50)
        .describe("X coordinate. Defaults to 50."),
      y: z
        .number()
        .optional()
        .default(50)
        .describe("Y coordinate. Defaults to 50."),
      width: z
        .number()
        .optional()
        .default(400)
        .describe("Width. Defaults to 400."),
      height: z
        .number()
        .optional()
        .default(300)
        .describe("Height. Defaults to 300."),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options): ExecuteResult => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "addChartToSlidePage",
        editor,
        options,
        (currentData, opts) => {
          const {
            slideId,
            chartType,
            chartDataJSON,
            chartConfigJSON,
            chartId,
            x,
            y,
            width,
            height,
          } = opts;

          // Validate JSON strings early within the mutator to keep executor clean
          try {
            JSON.parse(chartDataJSON || "[]");
          } catch (e) {
            throw new Error(`Invalid chartDataJSON: ${(e as Error).message}`);
          }
          try {
            JSON.parse(chartConfigJSON || "{}");
          } catch (e) {
            throw new Error(`Invalid chartConfigJSON: ${(e as Error).message}`);
          }

          const targetSlideIndex = currentData.slides.findIndex(
            (s) => s.id === slideId,
          );

          if (targetSlideIndex === -1) {
            throw new Error(
              `Slide with ID ${slideId} not found in deck ${options.deckNodeKey}.`,
            );
          }
          const targetSlide = currentData.slides[targetSlideIndex];
          if (!targetSlide) {
            throw new Error(
              `Target slide ${slideId} could not be retrieved from deck ${options.deckNodeKey}.`,
            );
          }

          const getNextZIndexForSlideElements = (
            elements: SlideElementSpec[],
          ): number => {
            if (!elements || elements.length === 0) return 0;
            return Math.max(...elements.map((el) => el.zIndex), -1) + 1;
          };

          const newChartGeneratedId = chartId || `chart-${Date.now()}`;
          const newChartElement: SlideElementSpec = {
            kind: "chart",
            id: newChartGeneratedId,
            x: x || 50,
            y: y || 50,
            width: width || 400,
            height: height || 300,
            chartType: chartType || "bar",
            chartData: chartDataJSON || "[]",
            chartConfig: chartConfigJSON || "{}",
            version: 1,
            zIndex: getNextZIndexForSlideElements(targetSlide.elements || []),
          };

          const updatedSlides = currentData.slides.map((slide, index) => {
            if (index === targetSlideIndex) {
              return {
                ...slide,
                elements: [...(slide.elements || []), newChartElement],
              };
            }
            return slide;
          });

          const summary = `Added new ${chartType} chart (ID: ${newChartGeneratedId}) to slide ${slideId} in deck ${options.deckNodeKey}.`;

          return {
            newData: {
              ...currentData,
              slides: updatedSlides,
            },
            summary: summary,
            newNodeKey: newChartGeneratedId,
          };
        },
        getTargetEditorInstance,
      );
    },
  });

  /* --------------------------------------------------------------
   * Update Slide Element Properties Tool
   * --------------------------------------------------------------*/
  const updateSlideElementProperties = tool({
    description:
      "Updates properties of an existing image or chart element on a specific slide page.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      slideId: z
        .string()
        .describe("The ID of the slide page containing the element."),
      elementId: z
        .string()
        .describe("The ID of the image or chart element to update."),
      kind: z
        .enum(["image", "chart"])
        .describe("The kind of element to update."),
      properties: z
        .object({
          // Common properties
          x: z.number().optional(),
          y: z.number().optional(),
          width: z.union([z.number(), z.literal("inherit")]).optional(),
          height: z.union([z.number(), z.literal("inherit")]).optional(),
          // Image specific
          url: z.string().optional(),
          // Chart specific
          chartType: z.enum(["bar", "line", "pie"]).optional(),
          chartDataJSON: z.string().optional(), // Should be valid JSON string
          chartConfigJSON: z.string().optional(), // Should be valid JSON string
        })
        .describe(
          "An object containing the properties to update. Only provided properties will be changed.",
        ),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options): ExecuteResult => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "updateSlideElementProperties",
        editor,
        options,
        (currentData, opts) => {
          const { slideId, elementId, kind, properties } = opts;

          if (kind === "chart") {
            if (properties.chartDataJSON) {
              try {
                JSON.parse(properties.chartDataJSON);
              } catch (e) {
                throw new Error(
                  `Invalid chartDataJSON: ${(e as Error).message}`,
                );
              }
            }
            if (properties.chartConfigJSON) {
              try {
                JSON.parse(properties.chartConfigJSON);
              } catch (e) {
                throw new Error(
                  `Invalid chartConfigJSON: ${(e as Error).message}`,
                );
              }
            }
          }

          const targetSlideIndex = currentData.slides.findIndex(
            (s) => s.id === slideId,
          );

          if (targetSlideIndex === -1) {
            throw new Error(
              `Slide with ID ${slideId} not found in deck ${options.deckNodeKey}.`,
            );
          }

          let elementFoundAndUpdated = false;
          const updatedSlides = currentData.slides.map((slide, index) => {
            if (index === targetSlideIndex) {
              const newElements = (slide.elements || []).map((el) => {
                if (el.id === elementId) {
                  if (el.kind !== kind) {
                    throw new Error(
                      `Element ${elementId} is of kind ${el.kind}, but update specified kind ${kind}.`,
                    );
                  }
                  elementFoundAndUpdated = true;
                  let specificUpdates = {};
                  if (kind === "image" && el.kind === "image") {
                    specificUpdates = {
                      url: properties.url ?? el.url,
                    };
                  }
                  if (kind === "chart" && el.kind === "chart") {
                    specificUpdates = {
                      chartType: properties.chartType ?? el.chartType,
                      chartData: properties.chartDataJSON ?? el.chartData,
                      chartConfig: properties.chartConfigJSON ?? el.chartConfig,
                    };
                  }

                  return {
                    ...el,
                    x: properties.x ?? el.x,
                    y: properties.y ?? el.y,
                    width: properties.width ?? el.width,
                    height: properties.height ?? el.height,
                    ...specificUpdates,
                    version: (el.version || 0) + 1,
                  };
                }
                return el;
              });
              return { ...slide, elements: newElements };
            }
            return slide;
          });

          if (!elementFoundAndUpdated) {
            throw new Error(
              `Element with ID ${elementId} of kind ${kind} not found on slide ${slideId} in deck ${options.deckNodeKey}.`,
            );
          }

          const summary = `Updated properties of ${kind} element (ID: ${elementId}) on slide ${slideId}. Changed: ${Object.keys(properties).join(", ")}`;

          return {
            newData: {
              ...currentData,
              slides: updatedSlides,
            },
            summary: summary,
            newNodeKey: elementId,
          };
        },
        getTargetEditorInstance,
      );
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
    ...(insertExcalidrawDiagram && { insertExcalidrawDiagram }),
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
    ...(addBoxToSlidePage && { addBoxToSlidePage }),
    ...(setSlidePageBackground && { setSlidePageBackground }),
    ...(addImageToSlidePage && { addImageToSlidePage }),
    ...(addChartToSlidePage && { addChartToSlidePage }),
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
    ...(findAndSelectTextForComment && { findAndSelectTextForComment }),
    ...(removeCommentFromThread && { removeCommentFromThread }),
    ...(removeCommentThread && { removeCommentThread }),
    ...(updateBoxPropertiesOnSlidePage && { updateBoxPropertiesOnSlidePage }),
    ...(updateSlideElementProperties && { updateSlideElementProperties }),
    ...(setDeckMetadata && { setDeckMetadata }),
    ...(setSlideMetadata && { setSlideMetadata }),
  } as unknown as RuntimeToolMap;

  /* --------------------------------------------------------------
   * Save Storyboard Output Tool (for runStep3_StoryboardArchitect)
   * --------------------------------------------------------------*/
  const saveStoryboardOutput = tool({
    description:
      "Saves the generated storyboard outline. Use this tool to provide the array of slide objects you have created. Each object must conform to the SlideOutlineSchema.",
    parameters: z.object({
      slides: z
        .array(SlideOutlineSchema)
        .describe("An array of slide outline objects."),
    }),
    execute: async ({ slides }): ExecuteResult => {
      // This tool's primary job is to validate the input via its schema.
      // The actual saving/processing of this data happens in the calling function (runStep3_StoryboardArchitect)
      // by inspecting tool_calls and extracting the arguments.
      if (!slides || slides.length === 0) {
        return {
          success: false,
          error: "No slides provided to saveStoryboardOutput tool.",
        };
      }
      return {
        success: true,
        content: {
          summary: `Successfully received and validated ${slides.length} slide outlines via tool call.`,
        },
      };
    },
  });

  /* --------------------------------------------------------------
   * Save Slide Content and Notes Tool (for runStep4_SlideWriter)
   * --------------------------------------------------------------*/
  const saveSlideContentAndNotes = tool({
    description:
      "Saves the generated body content and refined speaker notes for a specific slide page. Use this tool to provide these details after generation.",
    parameters: SlideContentAndNotesSchema, // Use the defined schema here
    execute: async (args): ExecuteResult => {
      // Zod validation is handled by the tool infrastructure before this execute is called.
      // The calling function (runStep4_SlideWriter) will extract these args from the tool_call.
      return {
        success: true,
        content: {
          summary: `Successfully received and validated content for pageId: ${args.pageId}.`,
        },
      };
    },
  });

  /* --------------------------------------------------------------
   * Save Theme Style Suggestions Tool (for runStep5_StyleStylist)
   * --------------------------------------------------------------*/
  const saveThemeStyleSuggestions = tool({
    description:
      "Saves the suggested theme settings (colors, fonts, etc.) for the presentation. Use this tool to provide these details after generation.",
    parameters: ThemeSettingsSchema, // Use the defined schema here
    execute: async (args): ExecuteResult => {
      // Zod validation is handled by the tool infrastructure.
      // The calling function (runStep5_StyleStylist) will extract these args.
      return {
        success: true,
        content: {
          summary: `Successfully received and validated theme style suggestions. Template: ${args.templateName || "N/A"}`,
        },
      };
    },
  });

  /* --------------------------------------------------------------
   * Save Image Generation Request Tool (for runStep6_MediaGenerator)
   * --------------------------------------------------------------*/
  const saveImageGenerationRequest = tool({
    description:
      "Saves a request to generate an image for a specific slide. This captures the prompt and style hints. The actual image generation and insertion will be handled by the workflow using a dedicated service.",
    parameters: z.object({
      pageId: z
        .string()
        .describe("The ID of the slide page to generate an image for."),
      imagePrompt: z.string().describe("The prompt for the image generation."),
      styleHints: z
        .string()
        .describe("The style hints for the image generation."),
    }),
    execute: async (args): ExecuteResult => {
      // This tool primarily validates. The workflow will use these args.
      return {
        success: true,
        content: {
          summary: `Successfully received and validated image generation request for pageId: ${args.pageId}. Prompt: "${args.imagePrompt.substring(0, 50)}..."`,
        },
      };
    },
  });

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
            // Use 'editor' via closure from RuntimeToolsProvider
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
    saveStoryboardOutput, // Add the new tool here
    saveSlideContentAndNotes, // Add the new tool here
    saveThemeStyleSuggestions, // Add the new tool here
    saveImageGenerationRequest, // Add the new tool here
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
