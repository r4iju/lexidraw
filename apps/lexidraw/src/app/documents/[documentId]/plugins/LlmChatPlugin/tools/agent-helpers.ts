import { tool } from "ai";
import { z } from "zod";
import type { ChatDispatch } from "../llm-chat-context";

/* --------------------------------------------------------------
 * Plan or Clarify Tool
 * --------------------------------------------------------------*/

export const useChatTools = ({ dispatch }: { dispatch: ChatDispatch }) => {
  const requestClarificationOrPlan = tool({
    description: `Describe the steps *you* (the assistant) plan to take
        to accomplish the user's objective, phrased in the
        first person (e.g., 'First, I will...').
        However if the user's objective is unclear or ambiguous,
        you must ask for clarification including a description
        of what you can do.
        `.replaceAll("          ", ""),
    inputSchema: z.object({
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
    execute: async (args) => {
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

  const summarizeAfterToolCallExecution = tool({
    description:
      "Reports the final summary of actions taken to the user. This MUST be called as the final step after all other actions are complete.",
    inputSchema: z.object({
      summaryText: z
        .string()
        .describe(
          "A concise summary, phrased in the first person, of all actions performed in the previous steps (e.g., 'I formatted block X as a heading, then I inserted image Y').",
        ),
    }),
    execute: async ({ summaryText }) => {
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

  const sendReply = tool({
    description:
      "Sends a text-only reply to the user. Use this when the user's query clearly does not require document modification, such as asking a question or making a comment.",
    inputSchema: z.object({
      replyText: z
        .string()
        .describe("The text content of the reply to send to the user."),
    }),
    execute: async ({ replyText }) => {
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

  return {
    requestClarificationOrPlan,
    summarizeAfterToolCallExecution,
    sendReply,
  };
};
