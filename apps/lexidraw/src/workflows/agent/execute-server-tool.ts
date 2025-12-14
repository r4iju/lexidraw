import type { LanguageModelV2ToolResultOutput } from "@ai-sdk/provider";
import { ExecuteCodeSchema } from "@packages/types";
import { executeCodeInSandbox } from "~/server/llm/tools/code-execution";

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
  "use step";
  const { name, input, runId } = args;

  switch (name) {
    case "executeCode": {
      const parsed = ExecuteCodeSchema.safeParse(input);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path.map((p) => String(p)),
        }));
        return {
          type: "error-json",
          value: {
            ok: false,
            error: "Invalid executeCode input",
            issues,
          },
        };
      }

      const result = await executeCodeInSandbox(parsed.data, { runId });

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
