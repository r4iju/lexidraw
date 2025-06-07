import { tool } from "ai";
import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
} from "./common-schemas";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  LexicalNode,
  $getNodeByKey,
  $isTextNode,
  $createParagraphNode,
  $isElementNode,
} from "lexical";
import { useLexicalStyleUtils } from "../../../utils/lexical-style-utils";

export const useTextTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
    getResolvedEditorAndKeyMap,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();
  const { parseStyleString, reconstructStyleString } = useLexicalStyleUtils();

  const insertTextNode = tool({
    description:
      "Inserts a new TextNode containing the provided text. If relation is 'before' or 'after', an existing TextNode must be identified by anchorKey or anchorText. If relation is 'appendRoot', the TextNode will be wrapped in a Paragraph and appended to the document root.",
    parameters: z.object({
      text: z.string(),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options) => {
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
        resolveInsertionPoint,
      );
    },
  });

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
      fontWeight: z // ADDED
        .string()
        .optional()
        .describe(
          "CSS font-weight value (e.g., 'bold', 'normal', '700'). Empty string ('') removes.",
        ),
      fontStyle: z // ADDED
        .string()
        .optional()
        .describe(
          "CSS font-style value (e.g., 'italic', 'normal'). Empty string ('') removes.",
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
      // Add other common style properties as needed (textDecoration)
    }),
    execute: async ({
      anchorKey,
      editorKey,
      fontFamily,
      fontSize,
      fontWeight, // ADDED
      fontStyle, // ADDED
      color,
      backgroundColor,
    }) => {
      try {
        console.log("[applyTextStyle] Starting", {
          anchorKey,
          fontFamily,
          fontSize,
          fontWeight,
          fontStyle,
          color,
          backgroundColor,
        });
        let success = false;
        let finalSummary = "";
        let errorMsg: string | null = null;

        const { targetEditor, keyMap } = getResolvedEditorAndKeyMap(editorKey); // editorKey is the full path

        let liveAnchorKey = anchorKey; // anchorKey is the original key, e.g., DEFAULT_TEXT_NODE_ORIGINAL_KEY

        if (keyMap) {
          const resolvedKey = keyMap.get(anchorKey);
          if (resolvedKey) {
            liveAnchorKey = resolvedKey;
          } else {
            errorMsg = `Original anchorKey "${anchorKey}" not found in keyMap for editor "${editorKey}". KeyMap contains: ${Array.from(keyMap.keys()).join(", ")}`;
            console.error(`❌ [applyTextStyle] Error: ${errorMsg}`);
            return { success: false, error: errorMsg };
          }
        } else {
          // This case implies the editor was found but no keyMap was generated or needed (e.g. main editor).
          // For nested editors created via headless route, keyMap should exist.
          // If it's a live editor registered without original state, anchorKey must already be live.
          console.warn(
            `[applyTextStyle] No keyMap for editor "${editorKey}". Assuming anchorKey "${anchorKey}" is already a live key.`,
          );
        }

        targetEditor.update(() => {
          const targetNode = $getNodeByKey(liveAnchorKey); // Use the resolved live key

          if (!targetNode) {
            errorMsg = `Target node with live key ${liveAnchorKey} not found.`;
            return;
          }

          if (!$isTextNode(targetNode)) {
            errorMsg = `Target node (live key: ${liveAnchorKey}) is type '${targetNode.getType()}', but styles can only be applied to TextNodes.`;
            return;
          }

          // --- Store original text BEFORE styling ---
          const originalText = targetNode.getTextContent();
          console.log(
            `[applyTextStyle INTERNAL] Before setStyle: TextNode (live key ${liveAnchorKey}) has text: "${originalText}". Parent key: ${targetNode.getParent()?.getKey()}, Style: "${targetNode.getStyle()}"`,
          );

          let styleObj = parseStyleString(targetNode.getStyle());
          const appliedStyles: string[] = [];

          const updateStyle = (key: string, value: string | undefined) => {
            if (value === undefined) return;
            if (value === "") {
              if (key in styleObj) {
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

          updateStyle("font-family", fontFamily);
          updateStyle("font-size", fontSize);
          updateStyle("font-weight", fontWeight);
          updateStyle("font-style", fontStyle);
          updateStyle("color", color);
          updateStyle("background-color", backgroundColor);

          if (appliedStyles.length === 0 && !errorMsg) {
            finalSummary = `No style changes needed for TextNode (live key: ${liveAnchorKey}, original: ${anchorKey}).`;
            success = true;
            return;
          }

          if (errorMsg) return;

          const newStyleString = reconstructStyleString(styleObj);
          console.log(
            `[applyTextStyle INTERNAL] Applying style string: "${newStyleString}" to TextNode key ${liveAnchorKey}`,
          );

          // --- Get a writable version of the node ---
          const writableTextNode = targetNode.getWritable();
          writableTextNode.setStyle(newStyleString);

          const textAfterStyle = writableTextNode.getTextContent();
          console.log(
            `[applyTextStyle INTERNAL] After setStyle: TextNode (live key ${liveAnchorKey}) has text: "${textAfterStyle}". Parent key: ${writableTextNode.getParent()?.getKey()}, Style: "${writableTextNode.getStyle()}"`,
          );

          // --- Defensive setTextContent if text was cleared AND original text was not empty ---
          if (textAfterStyle === "" && originalText !== "") {
            console.warn(
              `[applyTextStyle INTERNAL] Text was cleared after setStyle for node ${liveAnchorKey}! Restoring original text: "${originalText}"`,
            );
            writableTextNode.setTextContent(originalText); // Restore it

            // Log again after attempting to restore
            console.log(
              `[applyTextStyle INTERNAL] After restoring text: TextNode (live key ${liveAnchorKey}) has text: "${writableTextNode.getTextContent()}"`,
            );
          }

          // Log parent paragraph children status
          const finalParagraph = writableTextNode
            .getParentOrThrow()
            .getWritable();
          if (finalParagraph && $isElementNode(finalParagraph)) {
            console.log(
              `[applyTextStyle INTERNAL] After setStyle & potential restore: Final Parent Paragraph (key ${finalParagraph.getKey()}) children count: ${finalParagraph.getChildrenSize()}`,
            );
            if (finalParagraph.getChildrenSize() > 0) {
              const firstChild = finalParagraph.getFirstChild();
              if ($isTextNode(firstChild)) {
                console.log(
                  `[applyTextStyle INTERNAL] After setStyle & potential restore: Final Parent's first child (key ${firstChild.getKey()}) text: "${firstChild.getTextContent()}"`,
                );
              } else {
                console.log(
                  `[applyTextStyle INTERNAL] After setStyle & potential restore: Final Parent's first child is not a text node.`,
                );
              }
            } else {
              console.log(
                `[applyTextStyle INTERNAL] After setStyle & potential restore: Final Parent Paragraph has NO children.`,
              );
            }
          }

          finalSummary = `Applied styles to TextNode (key: ${anchorKey}): ${appliedStyles.join(", ")}. Original text was "${originalText}", after style it was "${textAfterStyle}"${textAfterStyle === "" && originalText !== "" ? ", then restored." : "."}`;
          success = true;
        });

        if (errorMsg) {
          console.error(`❌ [applyTextStyle] Error during update: ${errorMsg}`);
          return { success: false, error: errorMsg };
        }

        const latestState = editor.getEditorState();
        const stateJson = latestState.toJSON();
        console.log(
          `✅ [applyTextStyle] ${success ? "Success" : "No changes"}: ${finalSummary}`,
        );
        return {
          success: success,
          content: {
            summary: finalSummary,
            updatedEditorStateJson: stateJson,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [applyTextStyle] Error:`, errorMsg);
        const latestState = editor.getEditorState();
        const stateJson = latestState.toJSON();
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

  return {
    insertTextNode,
    applyTextStyle,
  };
};
