import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { PollNode } from "../../../nodes/PollNode";
import { InsertPollNodeSchema } from "@packages/types";

export const usePollTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  const insertPollNode = tool({
    description:
      "Inserts a new PollNode with a question and a list of option texts. Each option text will be converted into a poll option with a unique ID and an empty vote count. PollNode is a block-level element. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    inputSchema: InsertPollNodeSchema,
    execute: async (options) => {
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
        resolveInsertionPoint,
      );
    },
  });
  return {
    insertPollNode,
  };
};
