import { $getNodeByKey, LexicalEditor } from "lexical";
import {
  DeckStrategicMetadata,
  SlideElementSpec,
  SlideData,
  SlideDeckData,
  SlideNode,
  SlideStrategicMetadata,
  ThemeSettingsSchema,
} from "../../../nodes/SlideNode/SlideNode";
import { useCommonUtilities } from "./common";
import { EditorKeySchema, InsertionAnchorSchema, InsertionRelationSchema } from "./common-schemas";
import { tool } from "ai";
import { z } from "zod";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  DEFAULT_TEXT_NODE_ORIGINAL_KEY,
  useEmptyContent,
} from "../../../initial-content";
import { KeyedSerializedEditorState } from "../../../types";

const SlideContentAndNotesSchema = z.object({
  pageId: z
    .string()
    .describe("The ID of the slide page this content belongs to."),
  bodyContent: z
    .array(
      z.object({
        type: z
          .string()
          .describe(
            "Type of content block, e.g., 'heading1', 'paragraph', 'bulletList'.",
          ),
        text: z
          .string()
          .describe(
            "Text content for the block. For bulletList, items are separated by newline characters.",
          ),
      }),
    )
    .describe(
      "The main structured content for the slide body, as an array of content blocks.",
    ),
  refinedSpeakerNotes: z
    .string()
    .describe("The revised and improved speaker notes for the slide."),
});

type SlideDeckMutator<O extends Record<string, unknown>> = (
  currentData: SlideDeckData,
  options: O,
) => {
  newData: SlideDeckData;
  summary: string;
  newNodeKey?: string;
  additionalContent?: Record<string, string | undefined>;
};

export const useSlideTools = () => {
  const { getResolvedEditorAndKeyMap, insertionExecutor, $insertNodeAtResolvedPoint, resolveInsertionPoint } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  async function updateSlideDeckExecutor<
    O extends Record<string, unknown>, // Represents specific options for the mutator
    FullOptions extends O & { deckNodeKey: string; editorKey?: string }, // All options passed to execute
  >(
    toolName: string,
    baseEditor: LexicalEditor, // The base editor instance from useLexicalComposerContext
    options: FullOptions,
    mutator: SlideDeckMutator<O>,
    // getEditorInstance: (editorKey?: string) => LexicalEditor, // Function to get target editor // REMOVED
  ) {
    const { deckNodeKey, editorKey, ...specificMutatorOptions } = options;

    try {
      let result: { summary: string; newNodeKey?: string } | null = null;

      // SlideDeckNode modifications are typically on the main editor instance,
      // but we use getResolvedEditorAndKeyMap if editorKey was provided.
      // const targetEditor = getEditorInstance(editorKey); // REPLACED
      const { targetEditor } = getResolvedEditorAndKeyMap(editorKey);

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
          ...(mutatorResult.additionalContent && {
            additionalContent: mutatorResult.additionalContent,
          }),
        };
      });

      if (result === null) {
        // Explicitly check for null
        throw new Error(
          `[${toolName}] Update failed to produce a result for deck ${deckNodeKey}.`,
        );
      }

      // Assert the type of result after the null check
      const assertedResult = result as {
        summary: string;
        newNodeKey?: string;
        additionalContent?: Record<string, string | undefined>;
      };

      // Use baseEditor for getting the overall state
      const latestState = baseEditor.getEditorState();
      const stateJson = latestState.toJSON();

      console.log(`✅ [${toolName}] Success: ${assertedResult.summary}`);
      return {
        success: true,
        content: {
          summary: assertedResult.summary,
          updatedEditorStateJson: stateJson,
          newNodeKey: assertedResult.newNodeKey,
          ...(assertedResult.additionalContent ?? {}),
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `❌ [${toolName}] Error for deck ${deckNodeKey}:`,
        errorMsg,
      );
      // Use baseEditor for getting the overall state on error.
      const stateJsonOnError = baseEditor.getEditorState().toJSON();

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

  const insertSlideDeckNode = tool({
    description:
      "Inserts a new SlideDeckNode without any slides. SlideDeckNode is a block-level element. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    parameters: z.object({
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options) => {
      return insertionExecutor(
        "insertSlideDeckNode",
        editor,
        options,
        (resolution, _specificOptions, _currentTargetEditor) => {
          const newSlideDeckNode = SlideNode.$createSlideNode({
            slides: [],
            currentSlideId: null,
          });
          $insertNodeAtResolvedPoint(resolution, newSlideDeckNode);

          return {
            primaryNodeKey: newSlideDeckNode.getKey(),
            summaryContext: "Slide Deck",
          };
        },
        resolveInsertionPoint,
      );
    },
  });

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
    execute: async (options) => {
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
      );
    },
  });

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
    execute: async (options) => {
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
      );
    },
  });

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
    execute: async (options) => {
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
            backgroundColor: explicitBackgroundColor, // Renamed for clarity
            slideMetadata,
          } = opts;
          const newId = newSlideId || `slide-${Date.now()}`;

          // Determine background color: explicit > theme > default (undefined)
          let finalBackgroundColor = explicitBackgroundColor;
          if (
            finalBackgroundColor === undefined &&
            currentData.deckMetadata?.theme?.colorPalette?.slideBackground
          ) {
            finalBackgroundColor =
              currentData.deckMetadata.theme.colorPalette.slideBackground;
          }

          const newPage: SlideData = {
            id: newId,
            elements: [],
            backgroundColor: finalBackgroundColor, // Use the determined background color
            slideMetadata,
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
      );
    },
  });

  const emptyContent = useEmptyContent();
  const addBoxToSlidePage = tool({
    description:
      "Adds a new box element to a specific slide page within an existing SlideDeckNode. The content for the box should be provided as Markdown.",
    parameters: z.object({
      deckNodeKey: z.string().describe("The key of the target SlideDeckNode."),
      slideId: z
        .string()
        .describe("The ID of the slide page to add the box to."),
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
          "Optional X coordinate for the top-left corner of the box in pixels. Defaults to 50. The slide itself is 1280px wide.",
        ),
      y: z
        .number()
        .optional()
        .default(50)
        .describe(
          "Optional Y coordinate for the top-left corner of the box in pixels. Defaults to 50. The slide itself is 720px tall.",
        ),
      width: z
        .number()
        .optional()
        .default(300)
        .describe(
          "Optional width of the box in pixels. Defaults to 300. The slide itself is 1280px wide.",
        ),
      height: z
        .number()
        .optional()
        .default(50)
        .describe(
          "Optional height of the box in pixels. Defaults to 50. The slide itself is 720px tall.",
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
    execute: async (options) => {
      type MutatorOptions = Omit<typeof options, "deckNodeKey" | "editorKey">;
      return updateSlideDeckExecutor<MutatorOptions, typeof options>(
        "addBoxToSlidePage",
        editor,
        options,
        (currentData, opts) => {
          const { slideId, boxId, x, y, width, height, backgroundColor } = opts;

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

          const newBoxGeneratedId = boxId || `box-${Date.now()}`;

          const generatedEditorStateJSON =
            emptyContent as unknown as KeyedSerializedEditorState;

          const newBoxElement: SlideElementSpec = {
            kind: "box",
            id: newBoxGeneratedId,
            x: x || 50,
            y: y || 50,
            width: width || 300,
            height: height || 50,
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
            additionalContent: {
              textNodeKey: DEFAULT_TEXT_NODE_ORIGINAL_KEY,
            },
          };
        },
      );
    },
  });

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
    execute: async (options) => {
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
      );
    },
  });

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
    execute: async (options) => {
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
      );
    },
  });

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
    execute: async (options) => {
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
          zIndex: z.number().optional(),
        })
        .describe(
          "An object containing the properties to update. Only provided properties will be changed.",
        ),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options) => {
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
    execute: async (options) => {
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
    execute: async (options) => {
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
    execute: async (options) => {
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
      );
    },
  });

  /* --------------------------------------------------------------
   * Save Storyboard Output Tool (for runStep3_StoryboardArchitect)
   * --------------------------------------------------------------*/
  const saveStoryboardOutput = tool({
    description:
      "Saves the generated storyboard outline. Use this tool to provide the array of slide objects you have created. Each object must conform to the SlideOutlineSchema.",
    parameters: z.object({
      slides: z
        .array(
          z.object({
            slideNumber: z
              .number()
              .int()
              .positive()
              .describe("Sequential slide number, starting from 1."),
            title: z
              .string()
              .describe("Concise and engaging title for the slide."),
            keyMessage: z
              .string()
              .describe(
                "Bullet points summarizing the core message, can use Markdown.",
              ),
            visualIdea: z
              .string()
              .describe(
                "Brief textual description of a potential visual or chart.",
              ),
            speakerNotes: z.string().describe("Brief notes for the presenter."),
          }),
        )
        .describe("An array of slide outline objects."),
    }),
    execute: async ({ slides }) => {
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
    execute: async (args) => {
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
    parameters: ThemeSettingsSchema,
    execute: async (args) => {
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
    execute: async (args) => {
      // This tool primarily validates. The workflow will use these args.
      return {
        success: true,
        content: {
          summary: `Successfully received and validated image generation request for pageId: ${args.pageId}. Prompt: "${args.imagePrompt.substring(0, 50)}..."`,
        },
      };
    },
  });

  return {
    insertSlideDeckNode,
    setDeckMetadata,
    setSlideMetadata,
    addSlidePage,
    addBoxToSlidePage,
    removeSlidePage,
    reorderSlidePage,
    setSlidePageBackground,
    updateBoxPropertiesOnSlidePage,
    addImageToSlidePage,
    addChartToSlidePage,
    updateSlideElementProperties,
    saveStoryboardOutput,
    saveSlideContentAndNotes,
    saveThemeStyleSuggestions,
    saveImageGenerationRequest,
  };
};
