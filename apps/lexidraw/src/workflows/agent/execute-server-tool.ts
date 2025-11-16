import { executeCodeInSandbox } from "~/server/llm/tools/code-execution";
import type { LanguageModelV2ToolResultOutput } from "@ai-sdk/provider";

export interface ExecuteServerToolArgs {
  name: string;
  input: Record<string, unknown>;
  userId: string;
  runId: string;
}

/**
 * Executes server-side tools directly in the workflow.
 * Returns a result in the format expected by the agent workflow.
 */
export async function executeServerTool(
  args: ExecuteServerToolArgs,
): Promise<LanguageModelV2ToolResultOutput> {
  const { name, input } = args;

  switch (name) {
    case "executeCode": {
      const result = await executeCodeInSandbox(
        input as {
          code: string;
          language?: "node";
          timeoutMs?: number;
          resources?: {
            vcpus?: number;
            memoryMbPerVcpu?: number;
          };
        },
      );

      // Format as JSON tool result
      return {
        type: "json",
        value: {
          ok: result.ok,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        },
      };
    }

    default:
      throw new Error(`Unknown server tool: ${name}`);
  }
}
