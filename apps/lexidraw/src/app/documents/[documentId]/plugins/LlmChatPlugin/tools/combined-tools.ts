import { tool } from "ai";
import { z } from "zod";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RuntimeToolMap } from "../../../context/llm-context";

export const useCombinedTools = (individualTools: RuntimeToolMap) => {
  const [editor] = useLexicalComposerContext();

  const combinedTools = tool({
    description: `Executes a sequence of other tool calls sequentially. 
        Useful for batching independent or safely sequential operations to reduce latency. 
        Stops execution if any step fails.
        Should prefferably be used when inserting multiple similar nodes.
        `,
    parameters: z.object({
      calls: z
        .array(
          z.object({
            toolName: z
              .string()
              .describe(
                "The exact name of the tool to call (e.g., 'insertTextNode').",
              ),
            args: z
              .any()
              .describe(
                "The arguments object for the specified tool, matching its parameters.",
              ),
          }),
        )
        .min(1)
        .describe(
          "An array of tool calls to execute in order. Each object needs 'toolName' and 'args'.",
        ),
    }),
    execute: async ({ calls }) => {
      const results: { summary: string; stateJson?: string }[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let lastStateJson: Record<string, any> | undefined;

      try {
        console.log(
          `[combinedTools] Starting execution of ${calls.length} calls.`,
        );

        for (let i = 0; i < calls.length; i++) {
          const call = calls[i];
          if (!call) {
            throw new Error(`[combinedTools] Invalid call at index ${i}`);
          }
          const { toolName, args } = call;

          console.log(
            `[combinedTools] Executing step ${i + 1}: ${toolName}`,
            args,
          );

          // Find the tool in the preliminary map (using closure for 'individualTools')
          const subTool = individualTools[toolName]; // Corrected: individualTools should be in scope here

          if (!subTool) {
            const errorMsg = `[combinedTools] Error: Tool '${toolName}' not found. Available tools: ${Object.keys(individualTools).join(", ")}`;
            console.error(errorMsg);
            return { success: false, error: errorMsg };
          }

          // Check if execute is a function before calling
          if (typeof subTool.execute !== "function") {
            const errorMsg = `[combinedTools] Error: Tool '${toolName}' does not have a callable execute function.`;
            console.error(errorMsg);
            return { success: false, error: errorMsg };
          }

          /**
           * ts\n// before calling subTool.execute ...\nconst validatedArgs = subTool.parameters.parse(args);\nconst result = await subTool.execute(validatedArgs);\n
           */

          // @ts-expect-error - TODO: fix this
          const validatedArgs = subTool.parameters.parse(args);

          // @ts-expect-error - TODO: fix this
          const result = await subTool.execute(validatedArgs);

          if (!result.success) {
            const errorMsg = `[combinedTools] Error on step ${i + 1} (${toolName}): ${result.error ?? "Unknown error"}`;
            console.error(errorMsg);
            return {
              success: false,
              error: `Step ${i + 1} (${toolName}) failed: ${result.error ?? "Unknown error"}`,
              content: result.content,
            };
          }

          // Store summary and potentially update last state
          const summary =
            result.content?.summary ?? `${toolName} executed successfully.`;
          results.push({ summary });
          lastStateJson =
            result.content?.updatedEditorStateJson ?? lastStateJson;

          console.log(
            `[combinedTools] Step ${i + 1} (${toolName}) succeeded: ${summary}`,
          );
        } // End loop

        // If all calls succeeded
        const combinedSummary = results
          .map((r, idx) => `Step ${idx + 1}: ${r.summary}`)
          .join("\n");

        // Capture final state if not captured by the last step
        if (lastStateJson === undefined && calls.length > 0) {
          editor.read(() => {
            // Use 'editor' via closure from RuntimeToolsProvider
            lastStateJson = editor.getEditorState().toJSON();
          });
        }

        console.log(
          `✅ [combinedTools] All ${calls.length} steps executed successfully.`,
        );
        return {
          success: true,
          content: {
            summary: `Combined execution successful:\n${combinedSummary}`,
            updatedEditorStateJson: lastStateJson,
          },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `❌ [combinedTools] Unexpected error during execution:`,
          errorMsg,
        );
        return {
          success: false,
          error: `Combined execution failed: ${errorMsg}`,
        };
      }
    },
  });

  return { combinedTools };
};
