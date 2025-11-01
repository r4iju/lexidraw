import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TweetNode } from "../../../nodes/TweetNode";
import { InsertTweetNodeSchema } from "@packages/types";

export const useTweetTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  const insertTweetNode = tool({
    description:
      "Inserts a Tweet embed using the provided Tweet ID. TweetNode is a block-level element. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. Optionally, an alignment format can be applied.",
    inputSchema: InsertTweetNodeSchema,
    execute: async (options) => {
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
        resolveInsertionPoint,
      );
    },
  });

  return { insertTweetNode };
};
