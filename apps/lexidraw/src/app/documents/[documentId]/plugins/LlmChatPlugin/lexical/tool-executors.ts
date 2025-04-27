import {
  $isRootNode,
  $createTextNode,
  $createParagraphNode,
  $isElementNode,
  $getRoot,
  LexicalEditor,
  ElementNode,
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
import { tool } from "ai";

type ExecuteResult = Promise<{
  success: boolean;
  error?: string;
  details?: unknown;
}>;

export const useLexicalTools = (editor: LexicalEditor) => {
  const ListTypeEnum = z.enum(["bullet", "number", "check"]);
  // type alias for clarity
  type ListType = z.infer<typeof ListTypeEnum>;

  function $findFirstBlockNodeByText(text: string): ElementNode | null {
    const root = $getRoot();
    const queue: ElementNode[] = [root];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) continue;
      if (
        $isElementNode(node) &&
        !$isRootNode(node) &&
        node.isAttached() &&
        !node.isInline()
      ) {
        const nodeText = node.getTextContent();
        if (nodeText.includes(text)) {
          const nodeType = node.getType();
          if (
            nodeType === "paragraph" ||
            nodeType === "heading" ||
            nodeType === "listitem"
          ) {
            return node;
          }
        }
      }
      if ($isElementNode(node)) {
        const children = node.getChildren();
        for (const child of children) {
          if ($isElementNode(child)) {
            queue.push(child);
          }
        }
      }
    }
    return null;
  }

  const BaseFormatBlockSchema = z.object({
    operation: z.literal("formatBlock"),
    anchorText: z
      .string()
      .describe("Text content within the block to identify it."),
    formatAs: z.enum(["paragraph", "heading", "list"]), // keep list support
    headingTag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]).optional(),
    listType: ListTypeEnum.optional(),
  });

  const BaseInsertBlockSchema = z.object({
    operation: z.literal("insertBlock"),
    text: z.string(),
    blockType: z.enum(["paragraph", "heading", "list"]), // keep list support
    headingTag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]).optional(),
    listType: ListTypeEnum.optional(),
    relation: z.enum(["before", "after", "appendRoot"]),
    anchorText: z.string().optional(),
  });

  const DeleteBlockSchema = z.object({
    operation: z.literal("deleteBlock"),
    anchorText: z.string(),
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

  const lexicalLlmTools = {
    updateDocumentSemantically: tool({
      description:
        "Update the document based on a list of semantic instructions (format, insert, delete blocks, including lists). Anchor changes using text content.",
      parameters: UpdateDocumentParamsSchema,
      execute: async ({ instructions }): ExecuteResult => {
        console.log("Executing updateDocumentSemantically:", instructions);
        let overallSuccess = true;
        const errors: { index: number; error: string; details?: unknown }[] =
          [];

        try {
          editor.update(() => {
            instructions.forEach((instruction, index) => {
              try {
                let targetNode: ElementNode | null = null;
                if ("anchorText" in instruction && instruction.anchorText) {
                  if (
                    instruction.operation !== "insertBlock" ||
                    instruction.relation !== "appendRoot"
                  ) {
                    targetNode = $findFirstBlockNodeByText(
                      instruction.anchorText,
                    );
                    if (!targetNode) {
                      // fail gracefully if anchor not found for format/delete
                      if (
                        instruction.operation === "formatBlock" ||
                        instruction.operation === "deleteBlock"
                      ) {
                        console.warn(
                          `Anchor text "${instruction.anchorText}" not found for ${instruction.operation} at index ${index}. Skipping.`,
                        );
                        return; // skip instruction
                      } else {
                        // insert relative needs the anchor
                        throw new Error(
                          `Could not find block containing anchor text: "${instruction.anchorText}"`,
                        );
                      }
                    }
                  }
                }

                switch (instruction.operation) {
                  case "formatBlock": {
                    // validation checks are necessary
                    if (
                      instruction.formatAs === "heading" &&
                      !instruction.headingTag
                    ) {
                      throw new Error(`Validation failed: headingTag missing.`);
                    }
                    if (
                      instruction.formatAs === "list" &&
                      !instruction.listType
                    ) {
                      throw new Error(`Validation failed: listType missing.`);
                    }
                    if (!targetNode) {
                      throw new Error(`Target node not found for formatBlock.`);
                    }

                    console.log(
                      `Formatting block (key: ${targetNode.getKey()}, anchor: "${instruction.anchorText}")`,
                    );

                    // direct replace logic
                    let replacementNode: ElementNode | ListNode;
                    const originalText = targetNode.getTextContent();

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

                    console.log(
                      ` -> Replacing node with ${replacementNode.getType()}`,
                    );
                    targetNode.replace(replacementNode);
                    break;
                  }

                  case "insertBlock": {
                    // validation checks are necessary
                    if (
                      (instruction.relation === "before" ||
                        instruction.relation === "after") &&
                      !instruction.anchorText
                    ) {
                      throw new Error(`Validation failed: anchorText missing.`);
                    }
                    if (
                      instruction.blockType === "heading" &&
                      !instruction.headingTag
                    ) {
                      throw new Error(`Validation failed: headingTag missing.`);
                    }
                    if (
                      instruction.blockType === "list" &&
                      !instruction.listType
                    ) {
                      throw new Error(`Validation failed: listType missing.`);
                    }
                    if (instruction.relation !== "appendRoot" && !targetNode) {
                      throw new Error(
                        `Target node not found for relative insert.`,
                      );
                    }

                    let newNode: ElementNode | ListItemNode;
                    let finalNodeToInsert: ElementNode | ListNode;
                    let requiresListWrapper = false;
                    const listType =
                      instruction.blockType === "list"
                        ? (instruction.listType as ListType)
                        : undefined;

                    // create the core node
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

                    console.log(
                      `Preparing to insert ${instruction.blockType} "${instruction.text.substring(0, 20)}..."`,
                    );

                    if (instruction.relation === "appendRoot") {
                      console.log(` -> Appending to root.`);
                      $getRoot().append(finalNodeToInsert);
                    } else {
                      // before/after targetNode
                      if (!targetNode) {
                        throw new Error(
                          `Target node unexpectedly null for relative insert.`,
                        );
                      }
                      console.log(
                        ` -> Relation: ${instruction.relation} anchor "${instruction.anchorText}"`,
                      );

                      // refinement for list item insertion
                      if (
                        requiresListWrapper &&
                        listType &&
                        $isListItemNode(targetNode)
                      ) {
                        const parent = targetNode.getParent();
                        if (
                          $isListNode(parent) &&
                          parent.getListType() === listType
                        ) {
                          console.log(
                            ` -> Inserting list item directly into existing compatible list ${parent.getKey()}`,
                          );
                          finalNodeToInsert = newNode as ListItemNode; // Insert the item, not the wrapper
                        }
                      }

                      if (instruction.relation === "before") {
                        targetNode.insertBefore(finalNodeToInsert);
                      } else {
                        // after
                        targetNode.insertAfter(finalNodeToInsert);
                      }
                    }
                    break;
                  }

                  case "deleteBlock": {
                    // validation / find target
                    if (!instruction.anchorText) {
                      throw new Error("Anchor text required for deleteBlock.");
                    }
                    if (!targetNode) {
                      console.warn(
                        `Anchor text "${instruction.anchorText}" not found for deleteBlock at index ${index}. Skipping.`,
                      );
                      return;
                    }
                    console.log(
                      `Deleting block (anchor: "${instruction.anchorText}", key: ${targetNode.getKey()})`,
                    );
                    // handle removing parent list if last item
                    if ($isListItemNode(targetNode)) {
                      const parentList = targetNode.getParent();
                      if (
                        $isListNode(parentList) &&
                        parentList.getChildrenSize() === 1
                      ) {
                        console.log(
                          ` -> Removing parent list ${parentList.getKey()} as it was the last item.`,
                        );
                        parentList.remove();
                      } else {
                        targetNode.remove();
                      }
                    } else {
                      targetNode.remove();
                    }
                    break;
                  }
                }
              } catch (opError: unknown) {
                overallSuccess = false;
                const errorMsg = `Failed instruction [${index}] ${instruction.operation}: ${opError instanceof Error ? opError.message : String(opError)}`;
                console.error(errorMsg, "Instruction:", instruction, opError);
                errors.push({
                  index,
                  error: errorMsg,
                  details: String(opError),
                });
              }
            }); // end forEach instruction

            if (!overallSuccess) {
              const combinedErrorMsg = errors
                .map((e) => `[${e.index}] ${e.error}`)
                .join("\n");
              throw new Error(
                `One or more semantic instructions failed:\n${combinedErrorMsg}`,
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
          if (errors.length === 0) {
            errors.push({ index: -1, error: errorMsg, details });
          }
        }

        if (overallSuccess) {
          console.log("updateDocumentSemantically finished successfully.");
          return { success: true };
        } else {
          return {
            success: false,
            error: "One or more semantic instructions failed during execution.",
            details: errors,
          };
        }
      },
    }),
  };

  return { lexicalLlmTools };
};
