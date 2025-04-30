import { tool } from "ai";
import {
  $createParagraphNode,
  $createTextNode,
  LexicalEditor,
  ElementNode,
  LexicalNode,
  $getRoot,
  $isElementNode,
  $isRootNode,
} from "lexical";
import { $createHeadingNode, HeadingTagType } from "@lexical/rich-text";
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  ListNode,
  ListItemNode,
} from "@lexical/list";
import { z } from "zod";

import { buildDynamicEnums } from "./build-dynamic-enums";
import type { Action } from "./llm-chat-context";
import { RuntimeToolMap } from "../../context/llm-context";

/* ------------------------------------------------------------------
 * Types & helpers
 * -----------------------------------------------------------------*/
// Result schema from reference
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ResultSchema = z.object({
  success: z.boolean().describe("Whether the operation was successful."),
  error: z
    .string()
    .optional()
    .describe("An error message if the operation failed."),
  details: z
    .unknown()
    .optional()
    .describe("Additional details about the operation's outcome."),
  summary: z
    .string()
    .optional()
    .describe("A brief summary of the action taken, suitable for display."),
});

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

function findFirstBlockNodeByText(
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

/* ------------------------------------------------------------------
 * Factory
 * -----------------------------------------------------------------*/
export function buildRuntimeTools({
  editor,
  dispatch,
  searchAndInsertImage,
  generateAndInsertImage,
}: {
  editor: LexicalEditor;
  dispatch: React.Dispatch<Action>;
  searchAndInsertImage?: SearchAndInsertFunc;
  generateAndInsertImage?: GenerateAndInsertFunc;
}): RuntimeToolMap {
  /* 1.  build enums / spec */
  const { NodeSpecByType } = buildDynamicEnums(editor);
  console.log("🛠️ [ToolFactory] NodeSpecByType:", NodeSpecByType); // Log NodeSpecByType

  /* --------------------------------------------------------------
   * 3. Auto‑generate simple setter tools (setX-Y)
   * --------------------------------------------------------------*/
  const setterTools: RuntimeToolMap = {} as RuntimeToolMap;

  // TODO: make more generic; not only setters
  for (const node of Object.values(NodeSpecByType)) {
    for (const method of node.methods) {
      if (!method.startsWith("set")) continue;
      const attrName = method.slice(3); // e.g. setIndent -> Indent
      const toolName = `set${node.type}-${attrName}`;

      // Avoid duplicates when multiple node types share the same setter name
      if (setterTools[toolName]) continue;

      // @ts-expect-error TODO: fix this
      setterTools[toolName] = tool({
        description: `Calls ${method}(value) on a ${node.type} node.`,
        parameters: z.object({
          anchorKey: z.string().optional(),
          anchorText: z.string().optional(),
          value: z.any(),
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
              : findFirstBlockNodeByText(editor, anchorText);

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

            editor.update(() => fn.call(target, value));

            const summary = `${method} executed on ${node.type} (key: ${target.getKey()})`;
            console.log(`✅ [${toolName}] Success: ${summary}`);
            return { success: true, summary };
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
   * Tools from Reference
   * --------------------------------------------------------------*/

  // Schemas for Semantic Update Tool
  const ListTypeEnum = z.enum(["bullet", "number", "check"]);
  type ListType = z.infer<typeof ListTypeEnum>;

  const BaseFormatBlockSchema = z.object({
    operation: z.literal("formatBlock"),
    anchorText: z
      .string()
      .describe("Text content within the block (if anchorKey not provided).")
      .optional(),
    anchorKey: z
      .string()
      .describe("The unique key of the node (preferred over anchorText).")
      .optional(),
    formatAs: z.enum(["paragraph", "heading", "list"]),
    headingTag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]).optional(),
    listType: ListTypeEnum.optional(),
  });

  const BaseInsertBlockSchema = z.object({
    operation: z.literal("insertBlock"),
    text: z.string(),
    blockType: z.enum(["paragraph", "heading", "list"]),
    headingTag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]).optional(),
    listType: ListTypeEnum.optional(),
    relation: z.enum(["before", "after", "appendRoot"]),
    anchorText: z
      .string()
      .describe(
        "Anchor text for relative insertion (if anchorKey not provided).",
      )
      .optional(),
    anchorKey: z
      .string()
      .describe("Anchor key for relative insertion (preferred).")
      .optional(),
  });

  const DeleteBlockSchema = z.object({
    operation: z.literal("deleteBlock"),
    anchorText: z
      .string()
      .describe("Anchor text for deletion (if anchorKey not provided).")
      .optional(),
    anchorKey: z
      .string()
      .describe("Anchor key for deletion (preferred).")
      .optional(),
  });

  const SemanticInstructionSchema = z.discriminatedUnion("operation", [
    BaseFormatBlockSchema,
    BaseInsertBlockSchema,
    DeleteBlockSchema,
  ]);

  const UpdateDocumentParamsSchema = z.object({
    instructions: z.array(SemanticInstructionSchema),
    reason: z.string().optional(),
  });

  const PlanOrClarifyParamsSchema = z.object({
    operation: z
      .enum(["plan", "clarify"])
      .describe("Whether to generate a plan or to ask for clarification."),
    objective: z
      .string()
      .min(50)
      .max(1500)
      .optional()
      .describe(
        "What the user wants to achieve (for plan). This must be written in first person, and be a short concise summary of the planned actions to achieve the objective.",
      ),
    clarification: z
      .string()
      .min(50)
      .max(1500)
      .optional()
      .describe(
        "A clarifying question (for clarify). This must be written in first person, and be a short concise question that will help the user clarify their objective.",
      ),
  });

  const SearchAndInsertImageParamsSchema = z.object({
    query: z
      .string()
      .describe("The search query to find an image on Unsplash."),
  });

  const ImageGenerationParamsSchema = z.object({
    prompt: z
      .string()
      .describe("A detailed text description of the image to be generated."),
  });

  const requestClarificationOrPlan = tool({
    description: `Describe the steps *you* (the assistant) plan to take
          to accomplish the user's objective, phrased in the
          first person (e.g., 'First, I will...').
          However if the user's objective is not clear un unambiguous,
          you must ask for clarification including a description
          of what you can do.
          `.replaceAll("          ", ""),
    parameters: PlanOrClarifyParamsSchema,
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
          return { success: true, details: { plan: args.objective } };
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
          return {
            success: false,
            details: { clarification: args.clarification },
          };
        }
      }
    },
  });

  const searchAndInsertImageTool = searchAndInsertImage
    ? tool({
        description:
          "Searches for an image using the provided query on Unsplash and inserts the first result into the document (defaults to block).",
        parameters: SearchAndInsertImageParamsSchema,
        execute: async ({ query }): ExecuteResult => {
          try {
            await searchAndInsertImage(query);
            return {
              success: true,
              details: {
                query: query,
                status: "Success",
                summary: `Successfully inserted an image related to '${query}'.`,
              },
            };
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
              details: {
                query: query,
                status: "Failed",
                errorMessage: message,
              },
            };
          }
        },
      })
    : undefined;

  const imageGenerationTool = generateAndInsertImage
    ? tool({
        description:
          "Generates an image based on a user prompt and inserts it into the document.",
        parameters: ImageGenerationParamsSchema,
        execute: async ({ prompt }): ExecuteResult => {
          try {
            await generateAndInsertImage(prompt);
            return {
              success: true,
              details: {
                message: `Successfully generated and inserted an image for the prompt: "${prompt}"`,
                summary: `Generated and inserted image for: "${prompt}"`,
              },
            };
          } catch (error) {
            console.error("Error executing image generation tool:", error);
            const message =
              error instanceof Error
                ? error.message
                : "Failed to generate or insert image.";
            return {
              success: false,
              error: message,
              details: {
                prompt: prompt,
                status: "Failed",
                errorMessage: message,
              },
            };
          }
        },
      })
    : undefined;

  /* --------------------------------------------------------------
   * Summarize Execution Tool
   * --------------------------------------------------------------*/
  const SummarizeExecutionParamsSchema = z.object({
    summaryText: z
      .string()
      .describe(
        "A concise summary, phrased in the first person, of all actions performed in the previous steps (e.g., 'I formatted block X as a heading, then I inserted image Y').",
      ),
  });

  const summarizeExecution = tool({
    description:
      "Reports the final summary of actions taken to the user. This MUST be called as the final step after all other actions are complete.",
    parameters: SummarizeExecutionParamsSchema,
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
        return {
          success: true,
          summary: "Summary message dispatched.",
        };
      } catch (error) {
        console.error("Error dispatching summary message:", error);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to dispatch summary.";
        return {
          success: false,
          error: message,
          summary: "Failed to dispatch summary message.",
        };
      }
    },
  });

  /** TODO: Remove this tool and rely fully on the semantic instructions */
  const updateDocumentSemantically = tool({
    description:
      "Update the document based on a list of semantic instructions (format, insert, delete blocks). Anchor changes using unique node keys ('anchorKey') or text content ('anchorText'). anchorKey is preferred.",
    parameters: UpdateDocumentParamsSchema,
    execute: async ({ instructions }): ExecuteResult => {
      let overallSuccess = true;
      const errors: {
        index: number;
        error: string;
        details?: unknown;
        anchor?: string;
      }[] = [];
      let updateSummary = "";

      try {
        editor.update(() => {
          instructions.forEach((instruction, index) => {
            let resolvedTargetNode: LexicalNode | null = null; // General node for deletion or reference
            let resolvedTargetElementNode: ElementNode | null = null; // Specific element node needed for format/insert anchors
            let anchorIdentifier = "";

            try {
              const needsAnchor =
                instruction.operation !== "insertBlock" ||
                instruction.relation !== "appendRoot";
              const needsElementAnchor =
                instruction.operation === "formatBlock" ||
                (instruction.operation === "insertBlock" &&
                  instruction.relation !== "appendRoot");

              if (needsAnchor) {
                if (instruction.anchorKey) {
                  anchorIdentifier = `key "${instruction.anchorKey}"`;
                  resolvedTargetNode = findNodeByKey(
                    editor,
                    instruction.anchorKey,
                  ); // Use existing helper

                  // If we specifically need an ElementNode, check if the found node qualifies
                  if (needsElementAnchor) {
                    if (
                      resolvedTargetNode &&
                      $isElementNode(resolvedTargetNode) &&
                      !$isRootNode(resolvedTargetNode) &&
                      !resolvedTargetNode.isInline() &&
                      resolvedTargetNode.isAttached()
                    ) {
                      resolvedTargetElementNode = resolvedTargetNode; // It's a suitable ElementNode
                    } else if (resolvedTargetNode) {
                      throw new Error(
                        `Node with ${anchorIdentifier} found, but it's not a block element suitable for anchoring ${instruction.operation}.`,
                      );
                    }
                    // If resolvedTargetNode is null, validation below handles it.
                  }
                } else if (instruction.anchorText) {
                  anchorIdentifier = `text "${instruction.anchorText}"`;
                  resolvedTargetElementNode = findFirstBlockNodeByText(
                    editor,
                    instruction.anchorText,
                  ); // Use existing helper
                  resolvedTargetNode = resolvedTargetElementNode; // Assign to general node as well
                } else {
                  throw new Error(
                    `Missing anchorKey or anchorText for required anchor in ${instruction.operation}`,
                  );
                }

                // --- Anchor Validation ---
                if (!resolvedTargetNode) {
                  // Check if we found *any* node by the specified anchor
                  if (
                    (instruction.operation === "insertBlock" &&
                      instruction.relation !== "appendRoot") ||
                    instruction.operation === "formatBlock" ||
                    instruction.operation === "deleteBlock"
                  ) {
                    // These operations require the anchor to exist
                    console.warn(
                      `Anchor ${anchorIdentifier} not found for ${instruction.operation} at index ${index}. Skipping.`,
                    );
                    updateSummary += `Skipped ${instruction.operation} for missing ${anchorIdentifier}. `;
                    return; // Skip this instruction
                  }
                  // Other cases might not strictly need the anchor (e.g., appendRoot)
                }

                // Check if we have an ElementNode when specifically required
                if (needsElementAnchor && !resolvedTargetElementNode) {
                  // This implies anchorKey was used but didn't resolve to a suitable ElementNode
                  // Error thrown above in anchorKey logic, or handled by !resolvedTargetNode check.
                  // Defensive check:
                  if (resolvedTargetNode) {
                    throw new Error(
                      `Anchor ${anchorIdentifier} resolved to a non-element node, which cannot be used for ${instruction.operation}.`,
                    );
                  } else {
                    // Should have been caught by !resolvedTargetNode check already
                    throw new Error(
                      `Could not resolve anchor element node for ${instruction.operation} using ${anchorIdentifier}.`,
                    );
                  }
                }
                // --- End Anchor Validation ---
              } // End if(needsAnchor)

              // --- Execute Instruction ---
              // Use resolvedTargetNode for deleteBlock (if found by key or text)
              // Use resolvedTargetElementNode for formatBlock and insertBlock(relative) (must be an element)
              switch (instruction.operation) {
                case "formatBlock": {
                  if (!resolvedTargetElementNode)
                    throw new Error(
                      `Target element node not found/resolved for formatBlock using ${anchorIdentifier}.`,
                    );

                  // Validation
                  if (
                    instruction.formatAs === "heading" &&
                    !instruction.headingTag
                  )
                    throw new Error(
                      `Validation failed: headingTag missing for formatAs 'heading'.`,
                    );
                  if (instruction.formatAs === "list" && !instruction.listType)
                    throw new Error(
                      `Validation failed: listType missing for formatAs 'list'.`,
                    );

                  let replacementNode: ElementNode | ListNode;
                  const originalText =
                    resolvedTargetElementNode.getTextContent();

                  if (instruction.formatAs === "paragraph") {
                    replacementNode = $createParagraphNode().append(
                      $createTextNode(originalText),
                    );
                  } else if (instruction.formatAs === "heading") {
                    replacementNode = $createHeadingNode(
                      instruction.headingTag as HeadingTagType,
                    ).append($createTextNode(originalText));
                  } else {
                    // list
                    const listType = instruction.listType as ListType;
                    const listItem = $createListItemNode(
                      listType === "check" ? false : undefined,
                    ).append($createTextNode(originalText));
                    const listWrapper = $createListNode(listType);
                    listWrapper.append(listItem);
                    replacementNode = listWrapper;
                  }
                  resolvedTargetElementNode.replace(replacementNode);
                  updateSummary += `Formatted ${anchorIdentifier} as ${instruction.formatAs}. `;
                  break;
                }
                case "insertBlock": {
                  // Validation
                  if (
                    (instruction.relation === "before" ||
                      instruction.relation === "after") &&
                    !instruction.anchorKey &&
                    !instruction.anchorText
                  )
                    throw new Error(
                      `Validation failed: anchorKey or anchorText missing for relative insert.`,
                    );
                  if (
                    instruction.blockType === "heading" &&
                    !instruction.headingTag
                  )
                    throw new Error(
                      `Validation failed: headingTag missing for blockType 'heading'.`,
                    );
                  if (instruction.blockType === "list" && !instruction.listType)
                    throw new Error(
                      `Validation failed: listType missing for blockType 'list'.`,
                    );

                  let newNode: ElementNode | ListItemNode;
                  let finalNodeToInsert: ElementNode | ListNode;
                  let requiresListWrapper = false;
                  const listType =
                    instruction.blockType === "list"
                      ? (instruction.listType as ListType)
                      : undefined;

                  // Create node
                  if (instruction.blockType === "paragraph") {
                    newNode = $createParagraphNode().append(
                      $createTextNode(instruction.text),
                    );
                    finalNodeToInsert = newNode;
                  } else if (instruction.blockType === "heading") {
                    newNode = $createHeadingNode(
                      instruction.headingTag as HeadingTagType,
                    ).append($createTextNode(instruction.text));
                    finalNodeToInsert = newNode;
                  } else {
                    // list
                    newNode = $createListItemNode(
                      listType === "check" ? false : undefined,
                    ).append($createTextNode(instruction.text));
                    requiresListWrapper = true;
                    const listWrapper = $createListNode(listType as ListType);
                    listWrapper.append(newNode);
                    finalNodeToInsert = listWrapper;
                  }

                  // Insert node
                  if (instruction.relation === "appendRoot") {
                    $getRoot().append(finalNodeToInsert);
                    updateSummary += `Appended ${instruction.blockType}. `;
                  } else {
                    // before or after
                    if (!resolvedTargetElementNode)
                      throw new Error(
                        `Target element node unexpectedly null/unresolved for relative insert using ${anchorIdentifier}.`,
                      );

                    // Special list handling
                    if (
                      requiresListWrapper &&
                      listType &&
                      $isListItemNode(resolvedTargetElementNode)
                    ) {
                      const parentList = resolvedTargetElementNode.getParent();
                      if (
                        $isListNode(parentList) &&
                        parentList.getListType() === listType
                      ) {
                        finalNodeToInsert = newNode as ListItemNode; // Insert item directly
                      }
                    }
                    // Perform insert
                    if (instruction.relation === "before") {
                      resolvedTargetElementNode.insertBefore(finalNodeToInsert);
                    } else {
                      resolvedTargetElementNode.insertAfter(finalNodeToInsert);
                    }
                    updateSummary += `Inserted ${instruction.blockType} ${instruction.relation} ${anchorIdentifier}. `;
                  }
                  break;
                }
                case "deleteBlock": {
                  if (!resolvedTargetNode) {
                    // Node must have been found by anchor validation above
                    return; // Skip instruction (warning already logged)
                  }

                  // Use the resolvedTargetNode (could be Element or Decorator like Image)
                  if ($isListItemNode(resolvedTargetNode)) {
                    // Special handling for list items
                    const parentList = resolvedTargetNode.getParent();
                    if (
                      $isListNode(parentList) &&
                      parentList.getChildrenSize() === 1
                    ) {
                      parentList.remove(); // Remove the empty list wrapper
                      updateSummary += `Deleted list containing last item ${anchorIdentifier}. `;
                    } else {
                      resolvedTargetNode.remove(); // Remove just the list item
                      updateSummary += `Deleted list item ${anchorIdentifier}. `;
                    }
                  } else if (resolvedTargetNode.isAttached()) {
                    // Check attached before removing others
                    resolvedTargetNode.remove();
                    updateSummary += `Deleted node ${anchorIdentifier}. `;
                  } else {
                    console.warn(
                      `Node ${anchorIdentifier} was found but is not attached. Skipping deletion.`,
                    );
                    updateSummary += `Skipped deleting detached node ${anchorIdentifier}. `;
                  }
                  break;
                }
              } // End switch
            } catch (opError: unknown) {
              overallSuccess = false;
              const errorMsg = `Failed instruction [${index}] ${instruction.operation} (anchor: ${anchorIdentifier || "N/A"}): ${opError instanceof Error ? opError.message : String(opError)}`;
              console.error(errorMsg, "Instruction:", instruction, opError);
              errors.push({
                index,
                error: errorMsg,
                details: String(opError),
                anchor: anchorIdentifier,
              });
            }
          }); // end forEach

          if (!overallSuccess) {
            console.error(
              `One or more semantic instructions failed. See details above.`,
            );
          }
        }); // end editor.update
      } catch (updateError: unknown) {
        overallSuccess = false;
        const errorMsg = "Error during semantic update transaction.";
        const details =
          updateError instanceof Error
            ? updateError.message
            : String(updateError);
        console.error(errorMsg, updateError);
        if (errors.length === 0)
          errors.push({
            index: -1,
            error: errorMsg,
            details,
            anchor: "Transaction Level",
          });
      }

      // --- Return Result ---
      if (overallSuccess) {
        return {
          success: true,
          summary: updateSummary.trim() || "No effective changes applied.",
          details: {
            // Added summary to details as well for consistency
            message: "Document updates applied successfully.",
            summary: updateSummary.trim() || "No effective changes applied.",
          },
        };
      } else {
        return {
          success: false,
          error: "One or more semantic instructions failed during execution.",
          details: errors,
        };
      }
    },
  });

  /* --------------------------------------------------------------
   * 4. Combine & return
   * --------------------------------------------------------------*/

  return {
    ...setterTools,
    updateDocumentSemantically,
    requestClarificationOrPlan,
    searchAndInsertImageTool,
    imageGenerationTool,
    summarizeExecution,
    // TODO: fix this type
  } as unknown as RuntimeToolMap;
}
