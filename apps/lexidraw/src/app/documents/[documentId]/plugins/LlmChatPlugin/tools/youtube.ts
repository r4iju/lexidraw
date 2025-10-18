import { tool } from "ai";
import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
} from "./common-schemas";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { YouTubeNode } from "../../../nodes/YouTubeNode";

export const useYoutubeTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  const insertYouTubeNode = tool({
    description:
      "Inserts a YouTube video embed using the provided video ID. YouTubeNode is a block-level element. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. Optionally, an alignment format can be applied.",
    inputSchema: z.object({
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
    execute: async (options) => {
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
        resolveInsertionPoint,
      );
    },
  });

  return { insertYouTubeNode };
};
