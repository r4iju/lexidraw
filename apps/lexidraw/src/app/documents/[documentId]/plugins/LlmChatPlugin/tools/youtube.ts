import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { YouTubeNode } from "../../../nodes/YouTubeNode";
import { InsertYouTubeNodeSchema } from "@packages/types";

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
    inputSchema: InsertYouTubeNodeSchema,
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
