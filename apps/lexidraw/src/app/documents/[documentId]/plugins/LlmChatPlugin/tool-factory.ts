/* eslint-disable @typescript-eslint/no-unused-vars */

import { tool } from "ai";
import { z } from "zod";

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
  $isRangeSelection,
  $getSelection,
  type RangeSelection,
  type NodeSelection,
  $isParagraphNode,
  $insertNodes,
} from "lexical";
import {
  $createCodeNode,
  $createCodeHighlightNode,
  $isCodeNode,
  $isCodeHighlightNode,
} from "@lexical/code";
import { $createHeadingNode, type HeadingTagType } from "@lexical/rich-text";
import {
  $createListNode,
  $createListItemNode,
  $isListNode,
  $isListItemNode,
} from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { $createMarkNode, $isMarkNode } from "@lexical/mark";
import { $createTableNode, $isTableNode } from "@lexical/table";
import { $createHashtagNode, $isHashtagNode } from "@lexical/hashtag";
import { $createLinkNode, $isLinkNode } from "@lexical/link";
import { $createOverflowNode, $isOverflowNode } from "@lexical/overflow";

/** Standard Nodes */
import { ElementNode, LexicalNode, TextNode, ParagraphNode } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { CodeNode } from "@lexical/code";
import { MarkNode } from "@lexical/mark";
import { TableNode } from "@lexical/table";

/** Custom Nodes */
import { EquationNode } from "../../nodes/EquationNode";
import { FigmaNode } from "../../nodes/FigmaNode";
import { ImageNode } from "../../nodes/ImageNode/ImageNode";
import { AutocompleteNode } from "../../nodes/AutocompleteNode";
import { CollapsibleContainerNode } from "../../plugins/CollapsiblePlugin/CollapsibleContainerNode";
import { CollapsibleContentNode } from "../../plugins/CollapsiblePlugin/CollapsibleContentNode";
import { CollapsibleTitleNode } from "../../plugins/CollapsiblePlugin/CollapsibleTitleNode";
import { ExcalidrawNode } from "../../nodes/ExcalidrawNode/index";
import { InlineImageNode } from "../../nodes/InlineImageNode/InlineImageNode";
import { LayoutContainerNode } from "../../nodes/LayoutContainerNode";
import { LayoutItemNode } from "../../nodes/LayoutItemNode";
import { PageBreakNode } from "../../nodes/PageBreakNode";
import { PollNode } from "../../nodes/PollNode";
import { TweetNode } from "../../nodes/TweetNode";
import { YouTubeNode } from "../../nodes/YouTubeNode";

import type { Action } from "./llm-chat-context";
import { RuntimeToolMap } from "../../context/llm-context";
import { makeRuntimeSpec } from "./reflect-editor-runtime";
import { useLexicalStyleUtils } from "../../utils/lexical-style-utils";

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
      .describe('type can be "key" or "text", never "heading"'),
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
type ListItemAnchor = z.infer<typeof ListItemAnchorSchema>;

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

// Result schema: Now includes structured content
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

type SearchAndInsertFunc = (
  query: string,
  insertAs?: "block" | "inline",
) => Promise<void>;

type GenerateAndInsertFunc = (prompt: string) => Promise<void>;

function findNodeByKey(
  editor: LexicalEditor,
  key?: string,
): LexicalNode | null {
  if (!key) return null;
  const node = editor.getEditorState()._nodeMap.get(key);
  return node ?? null;
}

function findFirstNodeByText(
  editor: LexicalEditor,
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
  editor: LexicalEditor,
  relation: InsertionRelation,
  anchor?: InsertionAnchor, // Anchor is optional only if relation is appendRoot
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
    target = findNodeByKey(editor, anchor.key);
  } else {
    // findFirstNodeByText needs to run within an update cycle to use $ commands
    editor.getEditorState().read(() => {
      target = findFirstNodeByText(editor, anchor.text);
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

/* ------------------------------------------------------------------
 * Factory
 * -----------------------------------------------------------------*/
export function useRuntimeToolsFactory({
  editor,
  dispatch,
  searchAndInsertImageFunc,
  generateAndInsertImageFunc,
}: {
  editor: LexicalEditor;
  dispatch: React.Dispatch<Action>;
  searchAndInsertImageFunc?: SearchAndInsertFunc;
  generateAndInsertImageFunc?: GenerateAndInsertFunc;
}): RuntimeToolMap {
  const { parseStyleString, reconstructStyleString } = useLexicalStyleUtils();

  /* 1.  build enums / spec */
  const buildDynamicEnums = (editor: LexicalEditor) => {
    const spec = makeRuntimeSpec(editor);

    // Block vs inline
    const blockTypes = spec.nodes
      .filter((n) => !n.isInline && !n.isDecorator)
      .map((n) => n.type) as [string, ...string[]];

    const inlineTypes = spec.nodes
      .filter((n) => n.isInline)
      .map((n) => n.type) as [string, ...string[]];

    return {
      BlockTypeE: z.enum(blockTypes),
      InlineTypeE: z.enum(inlineTypes),
      NodeSpecByType: Object.fromEntries(spec.nodes.map((n) => [n.type, n])),
    };
  };

  const { NodeSpecByType } = buildDynamicEnums(editor);
  console.log("🛠️ [ToolFactory] NodeSpecByType:", NodeSpecByType);

  /* ------------------------------------------------------------------
   * Helper: normalise the "value" field so every setter receives
   *         exactly the number (fn.length) of positional arguments.
   * -----------------------------------------------------------------*/
  function normaliseSetterArgs(
    fn: (...args: unknown[]) => unknown,
    rawValue: unknown,
  ): unknown[] {
    const paramCount = Math.max(fn.length, 1); // safety first
    let args: unknown[];

    // 1. Accept exact array → already ordered
    if (Array.isArray(rawValue)) {
      args = rawValue;
    }
    // 2. Plain object → extract width/height if possible, else use Object.values
    else if (rawValue !== null && typeof rawValue === "object") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { width, height } = rawValue as any; // Attempt to destructure common case
      if (width !== undefined || height !== undefined) {
        args = [width, height]; // Assumes order for width/height case
      } else {
        // Fallback for generic objects - order might not be guaranteed
        args = Object.values(rawValue as Record<string, unknown>);
      }
    }
    // 3. Everything else → wrap single primitive
    else {
      args = [rawValue];
    }

    // 4. Pad / trim to match arity for *all* setters
    if (args.length < paramCount) {
      args = [...args, ...Array(paramCount - args.length).fill(undefined)];
    } else if (args.length > paramCount) {
      args = args.slice(0, paramCount);
    }

    return args;
  }

  /* --------------------------------------------------------------
   * 3. Auto‑generate simple setter tools (setX-Y)
   * --------------------------------------------------------------*/
  const setterTools: RuntimeToolMap = {} as RuntimeToolMap;

  // TODO: make more generic; not only setters
  for (const node of Object.values(NodeSpecByType)) {
    for (const method of node.methods) {
      if (!method.startsWith("set")) continue;
      const attrName = method.slice(3); // e.g. setIndent -> Indent
      const toolName = `set${node.type}-${attrName}` as keyof RuntimeToolMap;

      // Avoid duplicates when multiple node types share the same setter name
      if (setterTools[toolName]) continue;

      // @ts-expect-error TODO: fix this
      setterTools[toolName] = tool({
        description: `Calls ${method} on a ${node.type} node.
If ${method} expects more than one parameter, pass **value** as an ordered array.${
          method === "setWidthAndHeight"
            ? `
Arguments should be [number | 'inherit', number | 'inherit'].`
            : ""
        }`,
        parameters: z.object({
          anchorKey: z.string().optional(),
          anchorText: z.string().optional(),
          value: z
            .union([z.unknown(), z.array(z.unknown())])
            .describe(
              "Single argument OR ordered array for multi‑param setters",
            ),
        }),
        execute: async ({ anchorKey, anchorText, value }) => {
          try {
            console.log(`▶️ [${toolName}] searching for target`, {
              anchorKey,
              anchorText,
            });

            // 1. resolve target
            const target = anchorKey
              ? findNodeByKey(editor, anchorKey)
              : findFirstNodeByText(editor, anchorText);

            if (!target) {
              console.error(`❌ [${toolName}] Error: Target node not found`);
              return { success: false, error: "Target node not found" };
            }

            console.log(
              `▶️ [${toolName}] found target: type=${target.getType()}, key=${target.getKey()}`,
            );

            // New guard: Check node type
            if (target.getType() !== node.type) {
              const errorMsg = `Anchor resolves to ${target.getType()}, but ${toolName} can only edit ${node.type}.`;
              console.error(`❌ [${toolName}] Error: ${errorMsg}`);
              return {
                success: false,
                error: errorMsg,
              };
            }

            // 2. call setter safely *outside* editor.update
            // @ts-expect-error TODO: fix this
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fn = target[method] as ((v: any) => void) | undefined;
            if (typeof fn !== "function") {
              const errorMsg = `${method} is not implemented on ${node.type}`;
              console.error(`❌ [${toolName}] Error: ${errorMsg}`);
              return {
                success: false,
                error: errorMsg,
              };
            }

            console.log(
              `▶️ [${toolName}] calling ${method} with value:`,
              value,
            );

            const targetKey = target.getKey(); // cache key only
            const paramCount = Math.max(fn.length, 1); // Define paramCount here

            // Normalize arguments based on expected count and function name
            const args = normaliseSetterArgs(fn, value);

            editor.update(() => {
              // always fetch a *fresh* writable instance first
              const live = $getNodeByKey(targetKey);
              if (!live) {
                throw new Error(`Node ${targetKey} vanished before update.`);
              }
              // Log arguments before applying
              console.log(
                `[setter] ${fn.name} expects ${paramCount} args, got:`,
                args,
              );
              // @ts-expect-error – dynamic method call, type safety handled by normaliseSetterArgs & checks
              fn.apply(live, args);

              if ("__maxWidth" in live) {
                console.log(
                  "[setimage-MaxWidth] maxWidth now =",
                  live.__maxWidth,
                );
              }

              if ("__width" in live && live.__width !== undefined) {
                console.log(
                  `[${toolName}] width now =`,
                  live.__width,
                  "height =",
                  // @ts-expect-error – dynamic method call, handled by normaliseSetterArgs
                  live.__height,
                );
              }
            });

            const summary = `${method} executed on ${node.type} (key: ${targetKey})`;
            console.log(`✅ [${toolName}] Success: ${summary}`);
            // Non-mutating (for state), return only summary
            return { success: true, content: { summary } };
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`❌ [${toolName}] Error:`, errorMsg);
            return { success: false, error: errorMsg };
          }
        },
      });
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
            await searchAndInsertImageFunc(query);
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
      anchor: InsertionAnchorSchema.optional(), // Make anchor optional, validate based on relation
    }),
    execute: async ({ text, relation, anchor }): ExecuteResult => {
      try {
        console.log("[insertTextNode] Starting", { text, relation, anchor });

        // 1. Resolve insertion point *outside* update cycle
        const resolution = await resolveInsertionPoint(
          editor,
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
        editor.update(() => {
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
                `Target node with key ${resolution.targetKey} not found within editor update.`,
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
    }),
    execute: async ({ text, tag, relation, anchor }): ExecuteResult => {
      try {
        console.log("[insertHeadingNode] Starting", {
          text,
          tag,
          relation,
          anchor,
        });

        // 1. Resolve insertion point *outside* update cycle
        const resolution = await resolveInsertionPoint(
          editor,
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
        editor.update(() => {
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
    }),
    execute: async ({ listType, text, relation, anchor }): ExecuteResult => {
      try {
        console.log("[insertListNode] Starting", {
          listType,
          text,
          relation,
          anchor,
        });

        const resolution = await resolveInsertionPoint(
          editor,
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
        editor.update(() => {
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
      anchor: ListItemAnchorSchema, // Anchor is required
    }),
    execute: async ({ text, relation, anchor }): ExecuteResult => {
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

        // --- Resolve anchor and perform validation INSIDE editor.read ---
        editor.read(() => {
          let resolvedTargetNode: LexicalNode | null = null;
          if (anchor.type === "key") {
            // Find node by key directly within read
            resolvedTargetNode = $getNodeByKey(anchor.key);
          } else {
            // Find node by text directly within read
            resolvedTargetNode = findFirstNodeByText(editor, anchor.text);
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
        editor.update(() => {
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
    }),
    execute: async ({
      language,
      initialText,
      relation,
      anchor,
    }): ExecuteResult => {
      try {
        console.log("[insertCodeBlock] Starting", {
          language,
          initialText,
          relation,
          anchor,
        });

        // 1. Resolve insertion point *outside* update cycle
        const resolution = await resolveInsertionPoint(
          editor,
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
        editor.update(() => {
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

  const insertMarkdown = tool({
    description:
      "Inserts content parsed from a Markdown string. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. This is efficient for inserting complex structures like multiple paragraphs, lists, headings, code blocks, etc., defined in Markdown format.",
    parameters: z.object({
      markdownText: z
        .string()
        .describe("The Markdown content to parse and insert."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
    }),
    execute: async ({ markdownText, relation, anchor }): ExecuteResult => {
      try {
        console.log("[insertMarkdown] Starting", {
          markdownText,
          relation,
          anchor,
        });

        // 1. Resolve insertion point *outside* update cycle
        const resolution = await resolveInsertionPoint(
          editor,
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

        editor.update(
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
   * Remove Node Tool
   * --------------------------------------------------------------*/
  const removeNode = tool({
    description: "Removes a node from the document using its key.",
    parameters: z.object({
      nodeKey: z.string().describe("The key of the node to remove."),
    }),
    execute: async ({ nodeKey }): ExecuteResult => {
      try {
        let removed = false;
        editor.update(() => {
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
    }),
    execute: async ({ nodeKey, anchorKey, relation }): ExecuteResult => {
      try {
        let moved = false;
        let errorMsg: string | null = null;
        editor.update(() => {
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
      fontFamily,
      fontSize,
      color,
      backgroundColor,
      // Add other destructured params here
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

        editor.update(() => {
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
      "Sends a text-only reply to the user. Use this when the user's query does not require document modification, such as asking a question or making a comment. This is the primary tool for 'chat' mode.",
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

  const individualTools = {
    ...setterTools,
    ...(insertTextNode && { insertTextNode }),
    ...(insertHeadingNode && { insertHeadingNode }),
    ...(insertListNode && { insertListNode }),
    ...(insertListItemNode && { insertListItemNode }),
    ...(insertCodeBlock && { insertCodeBlock }),
    ...(insertMarkdown && { insertMarkdown }),
    ...(applyTextStyle && { applyTextStyle }),
    ...(removeNode && { removeNode }),
    ...(moveNode && { moveNode }),
    ...(requestClarificationOrPlan && { requestClarificationOrPlan }),
    ...(summarizeExecution && { summarizeExecution }),
    ...(searchAndInsertImage && { searchAndInsertImage }),
    ...(generateAndInsertImage && { generateAndInsertImage }),
    ...(sendReply && { sendReply }), // Add the new tool here
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
          const subTool = individualTools[toolName];

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

          // @ts-expect-error - TODO: fix this
          const result = (await subTool.execute(args)) as z.infer<
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
  return {
    ...individualTools,
    combinedTools, // Add the wrapper tool
  } as unknown as RuntimeToolMap;
}
