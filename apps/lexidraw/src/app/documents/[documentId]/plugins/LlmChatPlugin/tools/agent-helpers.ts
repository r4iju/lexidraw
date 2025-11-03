import { tool } from "ai";
import { z } from "zod";
import type { ChatDispatch } from "../llm-chat-context";
import { generateUUID } from "~/lib/utils";
import { api } from "~/trpc/react";
// No runtime tool context required here; planner receives explicit availableTools

/* --------------------------------------------------------------
 * Plan or Clarify Tool
 * --------------------------------------------------------------*/

export const useChatTools = ({ dispatch }: { dispatch: ChatDispatch }) => {
  const planMutation = api.llm.plan.useMutation();
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
          const planMsgId = generateUUID();
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
              id: generateUUID(),
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
            id: generateUUID(),
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
            id: generateUUID(),
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

  const planNextToolSelection = tool({
    description:
      "Plans the next step by selecting appropriate tools for the next agent pass. Calls the planner API to determine which tools should be used for the next execution.",
    inputSchema: z.object({
      objective: z
        .string()
        .optional()
        .describe(
          "Optional objective describing what should be done next (e.g., 'add a second recipe beneath Chocolate ice cream').",
        ),
      availableTools: z
        .array(z.string())
        .min(1)
        .describe(
          "List of available tool names to consider for planning (provided by the orchestrator).",
        ),
      max: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Maximum number of tools to select (default: 6)."),
    }),
    execute: async ({ objective, availableTools, max }) => {
      try {
        // Get available tool names (excluding chat-only and decision tools)
        const chatOnly = new Set([
          "sendReply",
          "requestClarificationOrPlan",
          "summarizeAfterToolCallExecution",
          "planNextToolSelection",
        ]);
        const availableToolNames = Array.isArray(availableTools)
          ? availableTools.filter(
              (n: unknown) =>
                typeof n === "string" && !chatOnly.has(n as string),
            )
          : [];

        if (availableToolNames.length === 0) {
          return {
            success: false,
            error: "No available tools for planning",
          };
        }

        const data = await planMutation.mutateAsync({
          prompt: objective || "Continue with the next step",
          availableTools: availableToolNames,
          max: max ?? 6,
        });

        const tools: string[] = Array.isArray(data.tools)
          ? (data.tools as unknown[])
              .filter((x) => typeof x === "string")
              .slice(0, max ?? 6)
          : [];

        if (tools.length === 0) {
          return {
            success: false,
            error: "Planner returned no tools",
          };
        }

        console.log("[planNextToolSelection] Selected tools:", {
          tools,
          correlationId: data.correlationId,
        });

        return {
          success: true,
          content: {
            tools,
            correlationId: data.correlationId,
          },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Error calling planner API:", message);
        return {
          success: false,
          error: `Failed to plan next step: ${message}`,
        };
      }
    },
  });

  return {
    requestClarificationOrPlan,
    summarizeAfterToolCallExecution,
    sendReply,
    planNextToolSelection,
  };
};
